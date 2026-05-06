// services/gtfsPoller.js
// Polls every 15 seconds.
// Interpolates vehicle positions from static schedule data,
// detects significant delays, writes alerts to PostgreSQL,
// and broadcasts both positions and alerts via Socket.io.

const cron = require('node-cron');

const POLL_INTERVAL_SECONDS = 15;

// Delay thresholds for alert severity
const DELAY_MINOR_MINS    = 5;
const DELAY_MAJOR_MINS    = 15;
const DELAY_CRITICAL_MINS = 30;

// Alert TTL — alerts expire after 1 hour
const ALERT_TTL_MS = 60 * 60 * 1000;

/**
 * Linearly interpolates between two coordinates based on a 0–1 progress ratio.
 */
const interpolateCoords = (lat1, lng1, lat2, lng2, progress) => ({
  lat: lat1 + (lat2 - lat1) * progress,
  lng: lng1 + (lng2 - lng1) * progress,
});

/**
 * Returns current time as seconds since midnight in IST (UTC+5:30).
 */
const nowInSeconds = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  return ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
};

/**
 * Determines alert severity based on delay in minutes.
 */
const getSeverity = (delayMinutes) => {
  if (delayMinutes >= DELAY_CRITICAL_MINS) return 'critical';
  if (delayMinutes >= DELAY_MAJOR_MINS)    return 'major';
  if (delayMinutes >= DELAY_MINOR_MINS)    return 'minor';
  return null;
};

/**
 * Interpolates vehicle positions for all active trips in a city.
 */
const interpolatePositions = async (pool, cityId) => {
  const currentSeconds = nowInSeconds();

  const query = `
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
      tb.trip_id,
      tb.route_id,
      tb.gtfs_route_id,
      tb.route_color,
      sch.stop_sequence,
      EXTRACT(EPOCH FROM sch.arrival_time)   AS arrival_seconds,
      EXTRACT(EPOCH FROM sch.departure_time) AS departure_seconds,
      ST_X(s.geom) AS lng,
      ST_Y(s.geom) AS lat
    FROM trip_bounds tb
    JOIN schedules sch ON sch.trip_id = tb.trip_id
    JOIN stops     s   ON s.stop_id   = sch.stop_id
    ORDER BY tb.trip_id, sch.stop_sequence
  `;

  const { rows } = await pool.query(query, [cityId, currentSeconds]);
  if (rows.length === 0) return [];

  // Group by trip
  const tripMap = new Map();
  for (const row of rows) {
    if (!tripMap.has(row.trip_id)) {
      tripMap.set(row.trip_id, {
        tripId:    row.trip_id,
        routeId:   row.route_id,
        gtfsRouteId: row.gtfs_route_id,
        routeColor: row.route_color,
        stops: []
      });
    }
    tripMap.get(row.trip_id).stops.push(row);
  }

  const positions = [];

  for (const [, trip] of tripMap) {
    const stops = trip.stops;
    let prevStop = null;
    let nextStop = null;
    let delayMinutes = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const dep = parseFloat(stops[i].departure_seconds);
      const arr = parseFloat(stops[i + 1].arrival_seconds);
      if (currentSeconds >= dep && currentSeconds <= arr) {
        prevStop = stops[i];
        nextStop = stops[i + 1];

        // Delay = how much the current time exceeds the scheduled arrival
        // at the next stop (if we're already past it)
        const scheduledArrival = arr;
        if (currentSeconds > scheduledArrival) {
          delayMinutes = (currentSeconds - scheduledArrival) / 60;
        }
        break;
      }
    }

    if (!prevStop) {
      const last = stops[stops.length - 1];
      positions.push({
        cityId,
        tripId:       trip.tripId,
        routeId:      trip.gtfsRouteId,
        internalRouteId: trip.routeId,
        routeColor:   trip.routeColor,
        lat:          parseFloat(last.lat),
        lng:          parseFloat(last.lng),
        delayMinutes: 0,
        interpolated: false,
        lastUpdate:   new Date().toISOString()
      });
      continue;
    }

    const segmentDuration = parseFloat(nextStop.arrival_seconds) - parseFloat(prevStop.departure_seconds);
    const elapsed  = currentSeconds - parseFloat(prevStop.departure_seconds);
    const progress = segmentDuration > 0 ? Math.min(elapsed / segmentDuration, 1) : 0;

    const coords = interpolateCoords(
      parseFloat(prevStop.lat), parseFloat(prevStop.lng),
      parseFloat(nextStop.lat), parseFloat(nextStop.lng),
      progress
    );

    positions.push({
      cityId,
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

/**
 * Checks for delayed trips and writes alerts to PostgreSQL.
 * Broadcasts service_alert via Socket.io for critical/major delays.
 */
const detectAndWriteAlerts = async (pool, cityId, positions, io) => {
  for (const pos of positions) {
    const severity = getSeverity(pos.delayMinutes);
    if (!severity) continue;

    // Check if an active alert already exists for this trip
    const { rows: existing } = await pool.query(`
      SELECT alert_id FROM alerts
      WHERE trip_id = $1 AND is_active = true AND expires_at > NOW()
      LIMIT 1
    `, [pos.tripId]);

    if (existing.length > 0) continue; // Already alerted

    const message = `Route ${pos.routeId} is running approximately ${pos.delayMinutes} minutes late.`;
    const expiresAt = new Date(Date.now() + ALERT_TTL_MS);

    const { rows } = await pool.query(`
      INSERT INTO alerts (city_id, route_id, trip_id, severity, message, delay_minutes, expires_at)
      VALUES (
        (SELECT city_id FROM cities WHERE city_id = $1),
        $2, $3, $4, $5, $6, $7
      )
      RETURNING *
    `, [cityId, pos.internalRouteId, pos.tripId, severity, message, pos.delayMinutes, expiresAt]);

    const alert = rows[0];
    console.log(`🚨 Alert created: [${severity.toUpperCase()}] ${message}`);

    // Broadcast for major and critical delays
    if (severity === 'major' || severity === 'critical') {
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
    }
  }
};

/**
 * Core poll cycle — interpolate, cache in Redis, detect alerts, broadcast.
 */
const pollAndBroadcast = async (pool, cityId, redis, io) => {
  try {
    const positions = await interpolatePositions(pool, cityId);

    if (positions.length === 0) {
      console.log(`⏸️  Poller: No active trips for city ${cityId} at this time.`);
      return;
    }

    // Write positions to Redis with 15s TTL
    const pipeline = redis.pipeline();
    for (const pos of positions) {
      const key = `pos:${cityId}:${pos.routeId}:${pos.tripId}`;
      pipeline.set(key, JSON.stringify(pos), 'EX', POLL_INTERVAL_SECONDS);
    }
    await pipeline.exec();

    // Broadcast positions to all connected clients
    io.emit('transit_update', {
      cityId,
      positions,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Poller: Broadcast ${positions.length} vehicle positions.`);

    // Detect delays and write alerts
    await detectAndWriteAlerts(pool, cityId, positions, io);

  } catch (err) {
    console.error('❌ Poller error:', err.message);
  }
};

/**
 * Initializes the 15-second GTFS polling cron job.
 */
const initGtfsPoller = (pool, cityId, redis, io) => {
  console.log(`🚦 GTFS Poller initialized for city: ${cityId}`);

  pollAndBroadcast(pool, cityId, redis, io);

  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    pollAndBroadcast(pool, cityId, redis, io);
  });
};

module.exports = { initGtfsPoller };
