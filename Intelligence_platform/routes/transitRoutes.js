// routes/transitRoutes.js
// API endpoints for the frontend map:
//   GET /api/transit/:cityId/routes   — all routes with shapes as GeoJSON
//   GET /api/transit/:cityId/stops    — all stops as GeoJSON
//   GET /api/transit/stops/:stopId/arrivals — next arrivals at a stop

const express = require('express');
const router = express.Router();

// ==========================================
// GET /api/transit/:cityId/routes
// Returns all routes for a city with their
// polyline shapes as GeoJSON FeatureCollection.
// Used by the frontend to draw route lines on the map.
// ==========================================

router.get('/:cityId/routes', async (req, res) => {
  const { cityId } = req.params;
  const { mode } = req.query; // Optional filter: ?mode=Metro

  try {
    let query = `
      SELECT
        r.route_id,
        r.gtfs_route_id,
        r.route_short_name,
        r.route_color,
        tm.type AS mode,
        ST_AsGeoJSON(r.route_shape) AS shape_geojson
      FROM routes r
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE tm.city_id = $1
        AND r.route_shape IS NOT NULL
    `;

    const params = [cityId];

    if (mode) {
      query += ` AND tm.type = $2`;
      params.push(mode);
    }

    query += ` ORDER BY tm.type, r.route_short_name`;

    const { rows } = await req.pool.query(query, params);

    // Build GeoJSON FeatureCollection
    const features = rows.map(row => ({
      type: 'Feature',
      geometry: JSON.parse(row.shape_geojson),
      properties: {
        routeId:    row.route_id,
        gtfsId:     row.gtfs_route_id,
        shortName:  row.route_short_name,
        color:      row.route_color,
        mode:       row.mode
      }
    }));

    res.json({
      type: 'FeatureCollection',
      features,
      meta: { cityId, total: features.length }
    });

  } catch (err) {
    console.error('Routes endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

// ==========================================
// GET /api/transit/:cityId/stops
// Returns all stops for a city as GeoJSON.
// Optional ?mode=Metro filter.
// Used by the frontend to draw stop markers on the map.
// ==========================================

router.get('/:cityId/stops', async (req, res) => {
  const { cityId } = req.params;
  const { mode } = req.query;

  try {
    // Derive mode per stop via schedules → routes → transport_modes
    // DISTINCT ON stops so multi-mode stops appear only once
    let query = `
      SELECT DISTINCT ON (s.stop_id)
        s.stop_id,
        s.gtfs_stop_id,
        s.stop_name,
        ST_AsGeoJSON(s.geom) AS geom_geojson,
        tm.type AS mode
      FROM stops s
      JOIN schedules sch ON sch.stop_id = s.stop_id
      JOIN routes    r   ON r.route_id  = sch.route_id
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE s.city_id = $1
    `;

    const params = [cityId];

    if (mode) {
      query += ` AND tm.type = $2`;
      params.push(mode);
    }

    query += ` ORDER BY s.stop_id, tm.type`;

    const { rows } = await req.pool.query(query, params);

    const features = rows.map(row => ({
      type: 'Feature',
      geometry: JSON.parse(row.geom_geojson),
      properties: {
        stopId:   row.stop_id,
        gtfsId:   row.gtfs_stop_id,
        name:     row.stop_name,
        mode:     row.mode
      }
    }));

    res.json({
      type: 'FeatureCollection',
      features,
      meta: { cityId, total: features.length }
    });

  } catch (err) {
    console.error('Stops endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stops' });
  }
});

// ==========================================
// GET /api/transit/stops/:gtfsStopId/arrivals
// Returns the next N upcoming arrivals at a stop.
// Uses current IST time against the schedules table.
// Default: next 5 arrivals. Override with ?limit=10
// ==========================================

router.get('/stops/:gtfsStopId/arrivals', async (req, res) => {
  const { gtfsStopId } = req.params;
  const limit = parseInt(req.query.limit) || 5;

  try {
    // Get current time in IST as a TIME value PostgreSQL can compare against
    const query = `
      SELECT
        sch.trip_id,
        sch.arrival_time,
        sch.departure_time,
        r.gtfs_route_id,
        r.route_short_name,
        r.route_color,
        tm.type AS mode,
        -- Minutes until arrival from now (IST)
        ROUND(
          EXTRACT(EPOCH FROM (
            sch.arrival_time - (NOW() AT TIME ZONE 'Asia/Kolkata')::time
          )) / 60
        ) AS minutes_away
      FROM schedules sch
      JOIN stops s ON s.stop_id = sch.stop_id
      JOIN routes r ON r.route_id = sch.route_id
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE s.gtfs_stop_id = $1
        AND sch.arrival_time > (NOW() AT TIME ZONE 'Asia/Kolkata')::time
      ORDER BY sch.arrival_time
      LIMIT $2
    `;

    const { rows } = await req.pool.query(query, [gtfsStopId, limit]);

    if (rows.length === 0) {
      return res.json({
        gtfsStopId,
        arrivals: [],
        message: 'No upcoming arrivals found for this stop today.'
      });
    }

    res.json({
      gtfsStopId,
      arrivals: rows.map(row => ({
        tripId:       row.trip_id,
        routeId:      row.gtfs_route_id,
        routeName:    row.route_short_name,
        routeColor:   row.route_color,
        mode:         row.mode,
        arrivalTime:  row.arrival_time,
        departureTime: row.departure_time,
        minutesAway:  parseInt(row.minutes_away)
      }))
    });

  } catch (err) {
    console.error('Arrivals endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch arrivals' });
  }
});

module.exports = router;