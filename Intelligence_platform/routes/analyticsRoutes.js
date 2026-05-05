// routes/analyticsRoutes.js
const express = require('express');
const router  = express.Router();

router.get('/route/:routeId', async (req, res, next) => {
  const { routeId } = req.params;
  const { days = 7 } = req.query; // Default to last 7 days

  try {
    const { rows } = await req.pool.query(`
      SELECT 
        on_time_pct AS "onTime",
        avg_delay_mins AS "avgDelay",
        active_trips AS "activeTrips",
        recorded_at AS "timestamp"
      FROM route_analytics
      WHERE route_id = $1
        AND recorded_at > NOW() - (INTERVAL '1 day' * $2)
      ORDER BY recorded_at ASC
    `, [routeId, parseInt(days)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No analytics data found for this route.' });
    }

    res.json({ routeId, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;