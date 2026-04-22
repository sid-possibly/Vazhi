// services/gtfsPoller.js
// Polls every 15 seconds.
// Since KMRL does not publish a public GTFS-RT Protobuf feed, vehicle positions
// are interpolated from static schedule data based on the current time.
//
// Algorithm:
//   1. Find all trips that are currently active (started but not yet finished).
//   2. For each active trip, find the two consecutive stops that bracket NOW.
//   3. Interpolate the vehicle's position linearly between those two stops.
//   4. Write the result to Redis with a 15s TTL.
//   5. Broadcast the full positions payload to all Socket.io clients.

const cron = require('node-cron');

const POLL_INTERVAL_SECONDS = 15;

/**
 * Linearly interpolates between two coordinates based on a 0–1 progress ratio.
 */
const interpolateCoords = (lat1, lng1, lat2, lng2, progress) => ({
  lat: lat1 + (lat2 - lat1) * progress,
  lng: lng1 + (lng2 - lng1) * progress,
});

/**
 * Converts a TIME string "HH:MM:SS" to total seconds since midnight.
 */
const timeToSeconds = (timeStr) => {
  if (!timeStr) return null;
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

/**
 * Returns current time as seconds since midnight in IST (UTC+5:30).
 */
const nowInSeconds = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30
  const ist = new Date(now.getTime() + istOffset);
  return ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
};

/**
 * Core interpolation logic.
 * Queries active trips and computes estimated vehicle positions.
 *
 * @param {Pool}   pool     - pg Pool instance
 * @param {string} cityId   - UUID of the city to poll
 * @returns {Array}         - Array of position objects
 */
const interpolatePositions = async (pool, cityId) => {
  const currentSeconds = nowInSeconds();

  // Find all trips currently in progress:
  // A trip is active if the current time is between its first departure and last arrival.
  // For each active trip, fetch all stops with their times and coordinates,
  // ordered by stop_sequence so we can find the bracketing pair.
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

  // Group rows by trip_id
  const tripMap = new Map();
  for (const row of rows) {
    if (!tripMap.has(row.trip_id)) {
      tripMap.set(row.trip_id, {
        tripId: row.trip_id,
        routeId: row.gtfs_route_id,
        routeColor: row.route_color,
        stops: []
      });
    }
    tripMap.get(row.trip_id).stops.push(row);
  }

  const positions = [];

  for (const [, trip] of tripMap) {
    const stops = trip.stops;

    // Find the two consecutive stops that bracket the current time
    let prevStop = null;
    let nextStop = null;

    for (let i = 0; i < stops.length - 1; i++) {
      const dep = parseFloat(stops[i].departure_seconds);
      const arr = parseFloat(stops[i + 1].arrival_seconds);
      if (currentSeconds >= dep && currentSeconds <= arr) {
        prevStop = stops[i];
        nextStop = stops[i + 1];
        break;
      }
    }

    // If no bracket found (e.g. vehicle is dwelling at a stop), use last stop
    if (!prevStop) {
      const last = stops[stops.length - 1];
      positions.push({
        tripId: trip.tripId,
        routeId: trip.routeId,
        routeColor: trip.routeColor,
        lat: parseFloat(last.lat),
        lng: parseFloat(last.lng),
        interpolated: false,
        lastUpdate: new Date().toISOString()
      });
      continue;
    }

    // Compute linear interpolation progress (0 → 1)
    const segmentDuration = parseFloat(nextStop.arrival_seconds) - parseFloat(prevStop.departure_seconds);
    const elapsed = currentSeconds - parseFloat(prevStop.departure_seconds);
    const progress = segmentDuration > 0 ? Math.min(elapsed / segmentDuration, 1) : 0;

    const coords = interpolateCoords(
      parseFloat(prevStop.lat),
      parseFloat(prevStop.lng),
      parseFloat(nextStop.lat),
      parseFloat(nextStop.lng),
      progress
    );

    positions.push({
      tripId: trip.tripId,
      routeId: trip.routeId,
      routeColor: trip.routeColor,
      lat: coords.lat,
      lng: coords.lng,
      interpolated: true,
      lastUpdate: new Date().toISOString()
    });
  }

  return positions;
};

/**
 * Writes positions to Redis and broadcasts via Socket.io.
 *
 * @param {Pool}        pool     - pg Pool instance
 * @param {string}      cityId   - UUID of the city
 * @param {Redis}       redis    - ioredis client
 * @param {SocketIO}    io       - Socket.io server instance
 */
const pollAndBroadcast = async (pool, cityId, redis, io) => {
  try {
    const positions = await interpolatePositions(pool, cityId);

    if (positions.length === 0) {
      console.log(`⏸️  Poller: No active trips for city ${cityId} at this time.`);
      return;
    }

    // Write each position to Redis with 15s TTL
    const pipeline = redis.pipeline();
    for (const pos of positions) {
      const key = `pos:${pos.routeId}:${pos.tripId}`;
      pipeline.set(key, JSON.stringify(pos), 'EX', POLL_INTERVAL_SECONDS);
    }
    await pipeline.exec();

    // Broadcast to all connected Socket.io clients
    io.emit('transit_update', {
      cityId,
      positions,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Poller: Broadcast ${positions.length} vehicle positions.`);

  } catch (err) {
    console.error('❌ Poller error:', err.message);
  }
};

/**
 * Initializes the 15-second GTFS polling cron job.
 *
 * @param {Pool}     pool    - pg Pool instance
 * @param {string}   cityId  - UUID of the city to poll
 * @param {Redis}    redis   - ioredis client
 * @param {SocketIO} io      - Socket.io server instance
 */
const initGtfsPoller = (pool, cityId, redis, io) => {
  console.log(`🚦 GTFS Poller initialized for city: ${cityId}`);

  // Run immediately on startup, then every 15 seconds
  pollAndBroadcast(pool, cityId, redis, io);

  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    pollAndBroadcast(pool, cityId, redis, io);
  });
};

module.exports = { initGtfsPoller };