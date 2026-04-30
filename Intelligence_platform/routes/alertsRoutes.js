// routes/alertsRoutes.js
//
//   GET /api/alerts/:cityId                    — all active alerts for a city
//   GET /api/alerts/:cityId/route/:gtfsRouteId — alerts for a specific route

const express = require('express');
const router  = express.Router();

// ==========================================
// GET /api/alerts/:cityId
// Returns all active non-expired alerts for a city.
// Optional ?severity=critical|major|minor filter.
// ==========================================

router.get('/:cityId', async (req, res) => {
  const { cityId }   = req.params;
  const { severity } = req.query;

  try {
    let query = `
      SELECT
        a.alert_id,
        a.trip_id,
        a.severity,
        a.message,
        a.delay_minutes,
        a.created_at,
        a.expires_at,
        r.gtfs_route_id   AS route_id,
        r.route_short_name AS route_name,
        r.route_color
      FROM alerts a
      JOIN routes r ON r.route_id = a.route_id
      WHERE a.city_id = $1
        AND a.is_active  = true
        AND a.expires_at > NOW()
    `;
    const params = [cityId];

    if (severity) {
      query += ` AND a.severity = $2`;
      params.push(severity);
    }

    query += `
      ORDER BY
        CASE a.severity
          WHEN 'critical' THEN 1
          WHEN 'major'    THEN 2
          WHEN 'minor'    THEN 3
        END,
        a.created_at DESC
    `;

    const { rows } = await req.pool.query(query, params);

    res.json({
      cityId,
      total:  rows.length,
      alerts: rows.map(row => ({
        alertId:      row.alert_id,
        routeId:      row.route_id,
        routeName:    row.route_name,
        routeColor:   row.route_color,
        tripId:       row.trip_id,
        severity:     row.severity,
        message:      row.message,
        delayMinutes: row.delay_minutes,
        createdAt:    row.created_at,
        expiresAt:    row.expires_at
      }))
    });

  } catch (err) {
    console.error('Alerts fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch alerts.' });
  }
});

// ==========================================
// GET /api/alerts/:cityId/route/:gtfsRouteId
// Active alerts for a specific route.
// ==========================================

router.get('/:cityId/route/:gtfsRouteId', async (req, res) => {
  const { cityId, gtfsRouteId } = req.params;

  try {
    const { rows } = await req.pool.query(`
      SELECT
        a.alert_id,
        a.trip_id,
        a.severity,
        a.message,
        a.delay_minutes,
        a.created_at,
        a.expires_at,
        r.gtfs_route_id   AS route_id,
        r.route_short_name AS route_name,
        r.route_color
      FROM alerts a
      JOIN routes r ON r.route_id = a.route_id
      WHERE a.city_id       = $1
        AND r.gtfs_route_id = $2
        AND a.is_active     = true
        AND a.expires_at    > NOW()
      ORDER BY a.created_at DESC
    `, [cityId, gtfsRouteId]);

    res.json({
      cityId,
      routeId: gtfsRouteId,
      total:   rows.length,
      alerts:  rows.map(row => ({
        alertId:      row.alert_id,
        routeId:      row.route_id,
        routeName:    row.route_name,
        routeColor:   row.route_color,
        tripId:       row.trip_id,
        severity:     row.severity,
        message:      row.message,
        delayMinutes: row.delay_minutes,
        createdAt:    row.created_at,
        expiresAt:    row.expires_at
      }))
    });

  } catch (err) {
    console.error('Route alerts fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch route alerts.' });
  }
});

module.exports = router;