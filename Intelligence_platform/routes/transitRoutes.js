// routes/transitRoutes.js
const express = require('express');
const router  = express.Router();
const { validateStopSearch } = require('../middleware/validation');

const CITIES_CACHE_KEY = 'cache:cities';
const CITIES_CACHE_TTL = 300; // 5 minutes

// ── GET /api/transit/cities ───────────────────────────────────────────────────
// Cached in Redis for 5 minutes — satisfies NFR1 (city config caching) from SRS.

router.get('/cities', async (req, res, next) => {
  try {
    // Try Redis cache first
    const cached = await req.redis.get(CITIES_CACHE_KEY);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const { rows } = await req.pool.query(`
      SELECT
        c.city_id, c.name, c.slug, c.current_status,
        ST_X(c.center_coords) AS lng,
        ST_Y(c.center_coords) AS lat,
        (SELECT MAX(last_ingested_at) FROM gtfs_feed_metadata WHERE city_id = c.city_id) AS "lastUpdated",
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'modeId',        tm.mode_id,
            'type',          tm.type,
            'isEnabled',     tm.is_enabled,
            'dataSourceUrl', tm.data_source_url
          ) ORDER BY tm.type
        ) AS modes
      FROM cities c
      LEFT JOIN transport_modes tm ON tm.city_id = c.city_id
      GROUP BY c.city_id, c.name, c.slug, c.current_status, c.center_coords
      ORDER BY c.name
    `);

    const payload = { cities: rows };

    // Write to Redis cache — fire and forget (don't block the response)
    req.redis.set(CITIES_CACHE_KEY, JSON.stringify(payload), 'EX', CITIES_CACHE_TTL)
      .catch(err => console.error('Redis cache write failed:', err.message));

    res.json(payload);
  } catch (err) { next(err); }
});

// ── GET /api/transit/:cityId/routes ──────────────────────────────────────────

router.get('/:cityId/routes', async (req, res, next) => {
  const { cityId } = req.params;
  const { mode }   = req.query;

  try {
    let query = `
      SELECT
        r.route_id, r.gtfs_route_id, r.route_short_name,
        r.route_color, tm.type AS mode,
        ST_AsGeoJSON(r.route_shape) AS shape_geojson
      FROM routes r
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE tm.city_id = $1 AND r.route_shape IS NOT NULL
    `;
    const params = [cityId];
    if (mode) { query += ` AND tm.type = $2`; params.push(mode); }
    query += ` ORDER BY tm.type, r.route_short_name`;

    const { rows } = await req.pool.query(query, params);

    res.json({
      type: 'FeatureCollection',
      features: rows.map(row => ({
        type: 'Feature',
        geometry:   JSON.parse(row.shape_geojson),
        properties: {
          routeId:   row.route_id,
          gtfsId:    row.gtfs_route_id,
          shortName: row.route_short_name,
          color:     row.route_color,
          mode:      row.mode
        }
      })),
      meta: { cityId, total: rows.length }
    });
  } catch (err) { next(err); }
});

// ── GET /api/transit/:cityId/stops ────────────────────────────────────────────

router.get('/:cityId/stops', async (req, res, next) => {
  const { cityId } = req.params;
  const { mode }   = req.query;

  try {
    let query = `
      SELECT DISTINCT ON (s.stop_id)
        s.stop_id, s.gtfs_stop_id, s.stop_name,
        ST_AsGeoJSON(s.geom) AS geom_geojson,
        tm.type AS mode
      FROM stops s
      JOIN schedules sch ON sch.stop_id = s.stop_id
      JOIN routes    r   ON r.route_id  = sch.route_id
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE s.city_id = $1
    `;
    const params = [cityId];
    if (mode) { query += ` AND tm.type = $2`; params.push(mode); }
    query += ` ORDER BY s.stop_id, tm.type`;

    const { rows } = await req.pool.query(query, params);

    res.json({
      type: 'FeatureCollection',
      features: rows.map(row => ({
        type: 'Feature',
        geometry:   JSON.parse(row.geom_geojson),
        properties: {
          stopId: row.stop_id,
          gtfsId: row.gtfs_stop_id,
          name:   row.stop_name,
          mode:   row.mode
        }
      })),
      meta: { cityId, total: rows.length }
    });
  } catch (err) { next(err); }
});

// ── GET /api/transit/:cityId/stops/search ─────────────────────────────────────

router.get('/:cityId/stops/search', validateStopSearch, async (req, res, next) => {
  const { cityId }  = req.params;
  const { q, mode } = req.query;

  try {
    let query = `
      SELECT DISTINCT ON (s.stop_id)
        s.stop_id, s.gtfs_stop_id, s.stop_name,
        ST_Y(s.geom) AS lat, ST_X(s.geom) AS lng,
        tm.type AS mode,
        similarity(s.stop_name, $2) AS score
      FROM stops s
      JOIN schedules sch ON sch.stop_id = s.stop_id
      JOIN routes    r   ON r.route_id  = sch.route_id
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE s.city_id = $1 AND s.stop_name ILIKE $3
    `;
    const params = [cityId, q, `%${q.trim()}%`];
    if (mode) { query += ` AND tm.type = $4`; params.push(mode); }
    query += ` ORDER BY s.stop_id, score DESC LIMIT 10`;

    const { rows } = await req.pool.query(query, params);
    rows.sort((a, b) => b.score - a.score);

    res.json({
      query:   q,
      results: rows.map(row => ({
        stopId: row.stop_id,
        gtfsId: row.gtfs_stop_id,
        name:   row.stop_name,
        lat:    parseFloat(row.lat),
        lng:    parseFloat(row.lng),
        mode:   row.mode
      }))
    });
  } catch (err) { next(err); }
});

// ── GET /api/transit/stops/:gtfsStopId/arrivals ───────────────────────────────

router.get('/stops/:gtfsStopId/arrivals', async (req, res, next) => {
  const { gtfsStopId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);

  try {
    const { rows } = await req.pool.query(`
      SELECT
        sch.trip_id, sch.arrival_time, sch.departure_time,
        r.gtfs_route_id, r.route_short_name, r.route_color,
        tm.type AS mode,
        ROUND(
          EXTRACT(EPOCH FROM (
            sch.arrival_time - (NOW() AT TIME ZONE 'Asia/Kolkata')::time
          )) / 60
        ) AS minutes_away
      FROM schedules sch
      JOIN stops s  ON s.stop_id  = sch.stop_id
      JOIN routes r ON r.route_id = sch.route_id
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE s.gtfs_stop_id = $1
        AND sch.arrival_time > (NOW() AT TIME ZONE 'Asia/Kolkata')::time
      ORDER BY sch.arrival_time
      LIMIT $2
    `, [gtfsStopId, limit]);

    res.json({
      gtfsStopId,
      arrivals: rows.map(row => ({
        tripId:        row.trip_id,
        routeId:       row.gtfs_route_id,
        routeName:     row.route_short_name,
        routeColor:    row.route_color,
        mode:          row.mode,
        arrivalTime:   row.arrival_time,
        departureTime: row.departure_time,
        minutesAway:   parseInt(row.minutes_away)
      })),
      message: rows.length === 0
        ? 'No upcoming arrivals found for this stop today.'
        : undefined
    });
  } catch (err) { next(err); }
});

module.exports = router;