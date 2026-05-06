// routes/comparisonRoutes.js
// City comparison endpoint — side-by-side transit metrics for two Kerala cities.
//
//   GET /api/comparison?city1={uuid}&city2={uuid}
//
// Compares: reliability, active routes, disruption frequency (30d), avg AQI.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { fetchWithRetry } = require('../utils/apiWrapper');

/**
 * Fetches all comparison metrics for a single city.
 */
const getCityMetrics = async (pool, cityId) => {

  const [
    cityInfoResult,
    activeRoutesResult,
    reliabilityResult,
    disruptionResult
  ] = await Promise.all([

    // City name and slug
    pool.query(
      `SELECT name, slug, current_status FROM cities WHERE city_id = $1`,
      [cityId]
    ),

    // Active routes right now
    pool.query(`
      SELECT COUNT(DISTINCT r.route_id) AS active_routes,
             COUNT(DISTINCT tm.type)    AS active_modes
      FROM routes r
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE tm.city_id = $1
    `, [cityId]),

    // Average reliability from route_analytics (last 30 days)
    pool.query(`
      SELECT
        AVG(on_time_pct)    AS avg_on_time_pct,
        AVG(avg_delay_mins) AS avg_delay_mins,
        COUNT(*)            AS snapshot_count
      FROM route_analytics
      WHERE city_id = $1
        AND recorded_at > NOW() - INTERVAL '30 days'
    `, [cityId]),

    // Disruption frequency over past 30 days
    pool.query(`
      SELECT
        COUNT(*)                                          AS total_disruptions,
        COUNT(*) FILTER (WHERE severity = 'Critical')    AS critical_count,
        COUNT(*) FILTER (WHERE severity = 'Warning')     AS warning_count,
        COUNT(*) FILTER (WHERE severity = 'Info')        AS info_count,
        AVG(delay_minutes)                               AS avg_delay_when_disrupted
      FROM alerts
      WHERE city_id = $1
        AND created_at > NOW() - INTERVAL '30 days'
    `, [cityId])
  ]);

  const cityInfo   = cityInfoResult.rows[0];
  const routes     = activeRoutesResult.rows[0];
  const reliability = reliabilityResult.rows[0];
  const disruptions = disruptionResult.rows[0];

  return {
    cityId,
    name:          cityInfo?.name          || 'Unknown',
    slug:          cityInfo?.slug          || '',
    currentStatus: cityInfo?.current_status || 'Unknown',
    activeRoutes:  parseInt(routes?.active_routes || 0),
    activeModes:   parseInt(routes?.active_modes  || 0),
    reliability: {
      avgOnTimePct:    reliability?.snapshot_count > 0
        ? parseFloat(parseFloat(reliability.avg_on_time_pct).toFixed(1))
        : null,
      avgDelayMins:    reliability?.snapshot_count > 0
        ? parseFloat(parseFloat(reliability.avg_delay_mins).toFixed(2))
        : null,
      dataAvailable:   parseInt(reliability?.snapshot_count || 0) > 0
    },
    disruptions30d: {
      total:                parseInt(disruptions?.total_disruptions    || 0),
      critical:             parseInt(disruptions?.critical_count       || 0),
      warning:              parseInt(disruptions?.warning_count        || 0),
      info:                 parseInt(disruptions?.info_count           || 0),
      avgDelayWhenDisrupted: disruptions?.avg_delay_when_disrupted
        ? parseFloat(parseFloat(disruptions.avg_delay_when_disrupted).toFixed(1))
        : 0
    }
  };
};

/**
 * Fetches AQI for a city by name from OpenAQ.
 * Returns null if unavailable.
 */
const getCityAQI = async (cityName) => {
  try {
    const response = await fetchWithRetry(() =>
      axios.get('https://api.openaq.org/v2/latest', {
        params:  { city: cityName, parameter: ['pm25'] },
        headers: { 'X-API-Key': process.env.OPENAQ_KEY },
        timeout: 5000
      })
    );
    const measurements = response.data?.results?.[0]?.measurements || [];
    const pm25 = measurements.find(m => m.parameter === 'pm25');
    return pm25 ? parseFloat(pm25.value.toFixed(1)) : null;
  } catch {
    return null;
  }
};

// ── GET /api/comparison ───────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  const { city1, city2 } = req.query;

  if (!city1 || !city2) {
    return res.status(400).json({ error: 'city1 and city2 UUID query params are required.' });
  }

  if (city1 === city2) {
    return res.status(400).json({ error: 'city1 and city2 must be different cities.' });
  }

  try {
    // Fetch metrics for both cities in parallel
    const [metrics1, metrics2] = await Promise.all([
      getCityMetrics(req.pool, city1),
      getCityMetrics(req.pool, city2)
    ]);

    // Fetch AQI for both cities in parallel
    const [aqi1, aqi2] = await Promise.all([
      getCityAQI(metrics1.name),
      getCityAQI(metrics2.name)
    ]);

    metrics1.aqi = aqi1;
    metrics2.aqi = aqi2;

    // Compute winner for each category (null if no data)
    const winner = (val1, val2, higherIsBetter = true) => {
      if (val1 === null || val2 === null) return null;
      if (val1 === val2) return 'tie';
      return higherIsBetter
        ? (val1 > val2 ? 'city1' : 'city2')
        : (val1 < val2 ? 'city1' : 'city2');
    };

    res.json({
      city1: metrics1,
      city2: metrics2,
      comparison: {
        reliability:    winner(metrics1.reliability.avgOnTimePct,    metrics2.reliability.avgOnTimePct),
        fewerDelays:    winner(metrics1.reliability.avgDelayMins,     metrics2.reliability.avgDelayMins,     false),
        activeRoutes:   winner(metrics1.activeRoutes,                 metrics2.activeRoutes),
        fewerDisruptions: winner(metrics1.disruptions30d.total,       metrics2.disruptions30d.total,         false),
        betterAqi:      winner(
          metrics1.aqi !== null ? -metrics1.aqi : null,
          metrics2.aqi !== null ? -metrics2.aqi : null
        )
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) { next(err); }
});

module.exports = router;