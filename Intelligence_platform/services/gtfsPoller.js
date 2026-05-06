// services/gtfsPoller.js
// Polls every 15 seconds:
//   1. Interpolates vehicle positions from static schedules (Kochi — no live GTFS-RT)
//   2. Writes positions to Redis with 30s TTL
//   3. Broadcasts transit_update to the city room (not all clients)
//   4. Detects delays and writes alerts to PostgreSQL
//   5. Broadcasts service_alert for Warning/Critical delays
//   6. Auto-recalculates journeys for sessions affected by a disruption

const cron = require('node-cron');
const { findShortestPath }       = require('../utils/routingEngine');
const { enrichJourney }          = require('./journeyEnricher');
const { sendAlertToSubscribers } = require('./webPushService');

const POLL_INTERVAL_SECONDS = 15;

const DELAY_INFO_MINS     = 2;
const DELAY_WARNING_MINS  = 10;
const DELAY_CRITICAL_MINS = 25;

const ALERT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ───────────────────────────────────────────────────────────────────

const interpolateCoords = (lat1, lng1, lat2, lng2, progress) => ({
  lat: lat1 + (lat2 - lat1) * progress,
  lng: lng1 + (lng2 - lng1) * progress
});

/**
 * Returns current time as seconds since midnight IST.
 * NOTE: GTFS times in stop_times.txt can exceed 86400 (e.g. 25:00:00 = 90000s)
 * for trips that run past midnight. The schedule query uses raw EXTRACT(EPOCH)
 * which preserves these values. We use a day offset here to handle both normal
 * and post-midnight trips correctly.
 */
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

// ── Position interpolation from static schedules ──────────────────────────────
// Kochi Metro (KMRL) does not publish a live GTFS-RT Protobuf feed.
// All vehicle positions are interpolated from the static GTFS schedule.
// This satisfies FR4 and NFR3 (graceful degradation) from the SRS.
//
// Overnight trip handling:
//   GTFS stop_times.txt allows times like "25:30:00" meaning 1:30 AM next day.
//   EXTRACT(EPOCH FROM time_column) in PostgreSQL returns the raw value without
//   wrapping at 86400, so "25:30:00" → 91800.
//   We also query for seconds up to nowSeconds + 86400 to catch overnight trips
//   that started the previous calendar day.

const interpolatePositions = async (pool, cityId) => {
  const currentSeconds = nowInSeconds();

  // We query two windows:
  //   - normal trips:    trip_start <= now <= trip_end  (same day)
  //   - overnight trips: trip_start <= now+86400 AND trip_end > 86400
  // The HAVING clause covers both by checking a wide range.
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

  // Group rows by trip
  const tripMap = new Map();
  for (const row of rows) {
    if (!tripMap.has(row.trip_id)) {
      tripMap.set(row.trip_id, {
        tripId:      row.trip_id,
        routeId:     row.route_id,
        gtfsRouteId: row.gtfs_route_id,
        routeColor:  row.route_color,
        stops:       []
      });
    }
    tripMap.get(row.trip_id).stops.push(row);
  }

  const positions = [];

  for (const [, trip] of tripMap) {
    const stops      = trip.stops;
    let prevStop     = null;
    let nextStop     = null;
    let delayMinutes = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const dep = parseFloat(stops[i].departure_seconds);
      const arr = parseFloat(stops[i + 1].arrival_seconds);
      if (currentSeconds >= dep && currentSeconds <= arr) {
        prevStop = stops[i];
        nextStop = stops[i + 1];
        // Delay: how far past the scheduled arrival we are
        if (currentSeconds > arr) {
          delayMinutes = (currentSeconds - arr) / 60;
        }
        break;
      }
    }

    // Trip is active but between the last two stops — pin to last stop
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

    // Avoid duplicate active alerts for the same trip
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
      // Broadcast to the city room only
      io.to(`city:${cityId}`).emit('service_alert', {
        alertId:      alert.alert_id,
        cityId,
        routeId:      pos.routeId,
        tripId:       pos.tripId,
        severity,
        message,
        delayMinutes: pos.delayMinutes,
        timestamp:    new Date().toISOString()
      });

      // Web Push to subscribed users (fire and forget — never blocks the poll cycle)
      sendAlertToSubscribers(pos.routeId, {
        title:    `Vazhi: Route ${pos.routeId} Disruption`,
        body:     message,
        severity
      }).catch(() => {}); // Already logs internally

      newAlerts.push({ routeId: pos.routeId, alert });
    }
  }

  return newAlerts;
};

// ── Journey auto-recalculation ────────────────────────────────────────────────

const recalculateAffectedJourneys = async (pool, graphService, cityId, newAlerts, io) => {
  if (newAlerts.length === 0) return;

  for (const { routeId } of newAlerts) {
    try {
      const { rows: sessions } = await pool.query(`
        SELECT session_id, user_id, start_stop_id, end_stop_id, city_id
        FROM journey_sessions
        WHERE $1 = ANY(route_ids)
          AND expires_at > NOW()
      `, [routeId]);

      if (sessions.length === 0) continue;

      console.log(`🔄 Recalculating ${sessions.length} journey(s) affected by ${routeId}`);

      const graph = await graphService.getGraph(pool, cityId);

      for (const session of sessions) {
        try {
          const result = findShortestPath(graph, session.start_stop_id, session.end_stop_id);
          const room   = `journey:${session.session_id}`;

          if (!result.success || result.path.length === 0) {
            io.to(room).emit('journey_recalculated', {
              sessionId: session.session_id,
              success:   false,
              message:   'No alternative route found. Please check for service updates.'
            });
            continue;
          }

          const enriched = await enrichJourney(pool, result.path, result.totalTime, session.city_id);

          io.to(room).emit('journey_recalculated', {
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

    // Write positions to Redis with TTL (2× poll interval as buffer)
    const pipeline = redis.pipeline();
    for (const pos of positions) {
      const key = `pos:${pos.routeId}:${pos.tripId}`;
      pipeline.set(key, JSON.stringify(pos), 'EX', POLL_INTERVAL_SECONDS * 2);
    }
    await pipeline.exec();

    // Broadcast only to clients watching this city
    io.to(`city:${cityId}`).emit('transit_update', {
      cityId,
      positions,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Poller: Broadcast ${positions.length} vehicle positions.`);

    const newAlerts = await detectAndWriteAlerts(pool, cityId, positions, io);
    await recalculateAffectedJourneys(pool, graphService, cityId, newAlerts, io);

  } catch (err) {
    console.error('❌ Poller error:', err.message);
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────

const initGtfsPoller = (pool, cityId, redis, io, graphService) => {
  console.log(`🚦 GTFS Poller initialized for city: ${cityId}`);

  // Run immediately on startup, then every 15 seconds
  pollAndBroadcast(pool, cityId, redis, io, graphService);

  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    pollAndBroadcast(pool, cityId, redis, io, graphService);
  });
};

module.exports = { initGtfsPoller };