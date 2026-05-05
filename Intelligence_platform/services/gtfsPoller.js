// services/gtfsPoller.js
// Polls every 15 seconds:
//   1. Interpolates vehicle positions from static schedules
//   2. Writes positions to Redis
//   3. Broadcasts transit_update via Socket.io
//   4. Detects delays and writes alerts to PostgreSQL
//   5. Broadcasts service_alert for Warning/Critical delays
//   6. Auto-recalculates journeys for users whose active route is disrupted

const cron = require('node-cron');
const { findShortestPath } = require('../utils/routingEngine');
const { enrichJourney }    = require('./journeyEnricher');

const POLL_INTERVAL_SECONDS = 15;

// Delay thresholds aligned with SRS severity labels
const DELAY_INFO_MINS     = 2;
const DELAY_WARNING_MINS  = 10;
const DELAY_CRITICAL_MINS = 25;

const ALERT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ───────────────────────────────────────────────────────────────────

const interpolateCoords = (lat1, lng1, lat2, lng2, progress) => ({
  lat: lat1 + (lat2 - lat1) * progress,
  lng: lng1 + (lng2 - lng1) * progress,
});

const nowInSeconds = () => {
  const now       = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist       = new Date(now.getTime() + istOffset);
  return ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
};

const getSeverity = (delayMinutes) => {
  if (delayMinutes >= DELAY_CRITICAL_MINS) return 'Critical';
  if (delayMinutes >= DELAY_WARNING_MINS)  return 'Warning';
  if (delayMinutes >= DELAY_INFO_MINS)     return 'Info';
  return null;
};

// ── Position interpolation ────────────────────────────────────────────────────

const interpolatePositions = async (pool, cityId) => {
  const currentSeconds = nowInSeconds();

  const { rows } = await pool.query(`
    WITH trip_bounds AS (
      SELECT
        sch.trip_id,
        r.route_id,
        r.gtfs_route_id,
        r.route_color,
        MIN(EXTRACT(EPOCH FROM sch.departure_time)) AS trip_start,
        MAX(EXTRACT(EPOCH FROM sch.arrival_time))   AS trip_end
      FROM schedules sch
      JOIN routes r ON r.route_id = sch.route_id
      JOIN stops  s ON s.stop_id  = sch.stop_id
      WHERE s.city_id = $1
      GROUP BY sch.trip_id, r.route_id, r.gtfs_route_id, r.route_color
      HAVING
        MIN(EXTRACT(EPOCH FROM sch.departure_time)) <= $2
        AND MAX(EXTRACT(EPOCH FROM sch.arrival_time)) >= $2
    )
    SELECT
      tb.trip_id, tb.route_id, tb.gtfs_route_id, tb.route_color,
      sch.stop_sequence,
      EXTRACT(EPOCH FROM sch.arrival_time)   AS arrival_seconds,
      EXTRACT(EPOCH FROM sch.departure_time) AS departure_seconds,
      ST_X(s.geom) AS lng,
      ST_Y(s.geom) AS lat
    FROM trip_bounds tb
    JOIN schedules sch ON sch.trip_id = tb.trip_id
    JOIN stops     s   ON s.stop_id   = sch.stop_id
    ORDER BY tb.trip_id, sch.stop_sequence
  `, [cityId, currentSeconds]);

  if (rows.length === 0) return [];

  const tripMap = new Map();
  for (const row of rows) {
    if (!tripMap.has(row.trip_id)) {
      tripMap.set(row.trip_id, {
        tripId:         row.trip_id,
        routeId:        row.route_id,
        gtfsRouteId:    row.gtfs_route_id,
        routeColor:     row.route_color,
        stops:          []
      });
    }
    tripMap.get(row.trip_id).stops.push(row);
  }

  const positions = [];

  for (const [, trip] of tripMap) {
    const stops        = trip.stops;
    let prevStop       = null;
    let nextStop       = null;
    let delayMinutes   = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const dep = parseFloat(stops[i].departure_seconds);
      const arr = parseFloat(stops[i + 1].arrival_seconds);
      if (currentSeconds >= dep && currentSeconds <= arr) {
        prevStop = stops[i];
        nextStop = stops[i + 1];
        if (currentSeconds > arr) {
          delayMinutes = (currentSeconds - arr) / 60;
        }
        break;
      }
    }

    if (!prevStop) {
      const last = stops[stops.length - 1];
      positions.push({
        tripId:          trip.tripId,
        routeId:         trip.gtfsRouteId,
        internalRouteId: trip.routeId,
        routeColor:      trip.routeColor,
        lat:             parseFloat(last.lat),
        lng:             parseFloat(last.lng),
        delayMinutes:    0,
        interpolated:    false,
        lastUpdate:      new Date().toISOString()
      });
      continue;
    }

    const segmentDuration = parseFloat(nextStop.arrival_seconds) - parseFloat(prevStop.departure_seconds);
    const elapsed         = currentSeconds - parseFloat(prevStop.departure_seconds);
    const progress        = segmentDuration > 0 ? Math.min(elapsed / segmentDuration, 1) : 0;

    const coords = interpolateCoords(
      parseFloat(prevStop.lat), parseFloat(prevStop.lng),
      parseFloat(nextStop.lat), parseFloat(nextStop.lng),
      progress
    );

    positions.push({
      tripId:          trip.tripId,
      routeId:         trip.gtfsRouteId,
      internalRouteId: trip.routeId,
      routeColor:      trip.routeColor,
      lat:             coords.lat,
      lng:             coords.lng,
      delayMinutes:    Math.round(delayMinutes),
      interpolated:    true,
      lastUpdate:      new Date().toISOString()
    });
  }

  return positions;
};

// ── Alert detection ───────────────────────────────────────────────────────────

const detectAndWriteAlerts = async (pool, cityId, positions, io) => {
  const newAlerts = [];

  for (const pos of positions) {
    const severity = getSeverity(pos.delayMinutes);
    if (!severity) continue;

    const { rows: existing } = await pool.query(`
      SELECT alert_id FROM alerts
      WHERE trip_id = $1 AND is_active = true AND expires_at > NOW()
      LIMIT 1
    `, [pos.tripId]);

    if (existing.length > 0) continue;

    const message   = `Route ${pos.routeId} is running approximately ${pos.delayMinutes} minutes late.`;
    const expiresAt = new Date(Date.now() + ALERT_TTL_MS);

    const { rows } = await pool.query(`
      INSERT INTO alerts (city_id, route_id, trip_id, severity, message, delay_minutes, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [cityId, pos.internalRouteId, pos.tripId, severity, message, pos.delayMinutes, expiresAt]);

    const alert = rows[0];
    console.log(`🚨 Alert: [${severity}] ${message}`);

    if (severity === 'Warning' || severity === 'Critical') {
      io.emit('service_alert', {
        alertId:      alert.alert_id,
        cityId,
        routeId:      pos.routeId,
        tripId:       pos.tripId,
        severity,
        message,
        delayMinutes: pos.delayMinutes,
        timestamp:    new Date().toISOString()
      });

      newAlerts.push({ routeId: pos.routeId, alert });
    }
  }

  return newAlerts;
};

// ── Journey auto-recalculate ──────────────────────────────────────────────────
// When a Warning/Critical alert fires for a route, check if any active
// journey sessions include that route. If so, re-run Dijkstra and push
// the recalculated journey to that user's socket room.

const recalculateAffectedJourneys = async (pool, graphService, cityId, newAlerts, io) => {
  if (newAlerts.length === 0) return;

  for (const { routeId } of newAlerts) {
    try {
      // Find all active journey sessions that include this route
      const { rows: sessions } = await pool.query(`
        SELECT session_id, user_id, socket_id, start_stop_id, end_stop_id, city_id
        FROM journey_sessions
        WHERE $1 = ANY(route_ids)
          AND expires_at > NOW()
      `, [routeId]);

      if (sessions.length === 0) continue;

      console.log(`🔄 Recalculating ${sessions.length} journey(s) affected by ${routeId} disruption`);

      const graph = await graphService.getGraph(pool, cityId);

      for (const session of sessions) {
        try {
          const result = findShortestPath(graph, session.start_stop_id, session.end_stop_id);

          if (result.totalTime === Infinity || result.path.length === 0) {
            io.to(session.socket_id).emit('journey_recalculated', {
              sessionId: session.session_id,
              success:   false,
              message:   'No alternative route found. Please check for service updates.'
            });
            continue;
          }

          const enriched = await enrichJourney(pool, result.path, result.totalTime, session.city_id);

          io.to(session.socket_id).emit('journey_recalculated', {
            sessionId:   session.session_id,
            success:     true,
            reason:      `Route ${routeId} disruption detected. Your journey has been recalculated.`,
            origin:      session.start_stop_id,
            destination: session.end_stop_id,
            ...enriched,
            timestamp:   new Date().toISOString()
          });

          console.log(`✅ Recalculated journey for session ${session.session_id}`);

        } catch (err) {
          console.error(`❌ Failed to recalculate journey ${session.session_id}:`, err.message);
        }
      }

    } catch (err) {
      console.error(`❌ Journey recalculation lookup failed for route ${routeId}:`, err.message);
    }
  }
};

// ── Core poll cycle ───────────────────────────────────────────────────────────

const pollAndBroadcast = async (pool, cityId, redis, io, graphService) => {
  try {
    const positions = await interpolatePositions(pool, cityId);

    if (positions.length === 0) {
      console.log(`⏸️  Poller: No active trips at this time.`);
      return;
    }

    // Write to Redis
    const pipeline = redis.pipeline();
    for (const pos of positions) {
      const key = `pos:${pos.routeId}:${pos.tripId}`;
      pipeline.set(key, JSON.stringify(pos), 'EX', POLL_INTERVAL_SECONDS);
    }
    await pipeline.exec();

    // Broadcast positions
    io.emit('transit_update', {
      cityId,
      positions,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Poller: Broadcast ${positions.length} vehicle positions.`);

    // Detect delays and write alerts
    const newAlerts = await detectAndWriteAlerts(pool, cityId, positions, io);

    // Auto-recalculate affected journeys
    await recalculateAffectedJourneys(pool, graphService, cityId, newAlerts, io);

  } catch (err) {
    console.error('❌ Poller error:', err.message);
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────

const initGtfsPoller = (pool, cityId, redis, io, graphService) => {
  console.log(`🚦 GTFS Poller initialized for city: ${cityId}`);

  pollAndBroadcast(pool, cityId, redis, io, graphService);

  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    pollAndBroadcast(pool, cityId, redis, io, graphService);
  });
};

module.exports = { initGtfsPoller };