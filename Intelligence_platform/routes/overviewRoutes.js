// routes/overviewRoutes.js
// Kerala state-level overview metrics for the landing page top bar.
//
//   GET /api/overview/metrics
//
// Returns:
//   - Total active routes today across all cities
//   - Total active disruptions across all cities
//   - Average AQI across major Kerala cities
//   - Current weather advisory if any severe conditions exist

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { fetchWithRetry } = require('../utils/apiWrapper');

// Kerala cities to sample for AQI average
const KERALA_AQI_CITIES = ['Kochi', 'Thiruvananthapuram', 'Kozhikode', 'Thrissur'];

// Severe weather conditions that trigger an advisory
const SEVERE_CONDITIONS = ['Thunderstorm', 'Tornado', 'Hurricane', 'Squall', 'Extreme'];

// Kerala city centre coordinates for weather sampling
const KERALA_WEATHER_COORDS = [
  { city: 'Kochi',              lat: 9.9312,  lng: 76.2673 },
  { city: 'Thiruvananthapuram', lat: 8.5241,  lng: 76.9366 },
  { city: 'Kozhikode',          lat: 11.2588, lng: 75.7804 }
];

// ── GET /api/overview/metrics ─────────────────────────────────────────────────

router.get('/metrics', async (req, res, next) => {
  try {
    // Run all DB queries and external API calls in parallel
    const [
      activeRoutesResult,
      activeDisruptionsResult,
      aqiResults,
      weatherResults
    ] = await Promise.allSettled([

      // 1. Total active routes today (routes that have at least one active trip now)
      req.pool.query(`
        SELECT COUNT(DISTINCT r.route_id) AS total_active_routes
        FROM routes r
        JOIN schedules sch ON sch.route_id = r.route_id
        WHERE (NOW() AT TIME ZONE 'Asia/Kolkata')::time
          BETWEEN (
            SELECT MIN(departure_time) FROM schedules WHERE route_id = r.route_id
          )
          AND (
            SELECT MAX(arrival_time) FROM schedules WHERE route_id = r.route_id
          )
      `),

      // 2. Total active disruptions across all cities
      req.pool.query(`
        SELECT COUNT(*) AS total_disruptions,
               COUNT(*) FILTER (WHERE severity = 'Critical') AS critical_count,
               COUNT(*) FILTER (WHERE severity = 'Warning')  AS warning_count
        FROM alerts
        WHERE is_active = true AND expires_at > NOW()
      `),

      // 3. AQI data for major Kerala cities
      Promise.allSettled(
        KERALA_AQI_CITIES.map(city =>
          fetchWithRetry(() =>
            axios.get('https://api.openaq.org/v2/latest', {
              params:  { city, parameter: ['pm25'] },
              headers: { 'X-API-Key': process.env.OPENAQ_KEY },
              timeout: 5000
            })
          )
        )
      ),

      // 4. Weather for Kerala city centres
      Promise.allSettled(
        KERALA_WEATHER_COORDS.map(({ lat, lng }) =>
          fetchWithRetry(() =>
            axios.get('https://api.openweathermap.org/data/2.5/weather', {
              params:  { lat, lon: lng, appid: process.env.WEATHER_KEY, units: 'metric' },
              timeout: 5000
            })
          )
        )
      )
    ]);

    // ── Process active routes ────────────────────────────────────────────────
    const totalActiveRoutes = activeRoutesResult.status === 'fulfilled'
      ? parseInt(activeRoutesResult.value.rows[0]?.total_active_routes || 0)
      : 0;

    // ── Process disruptions ──────────────────────────────────────────────────
    const disruptionRow = activeDisruptionsResult.status === 'fulfilled'
      ? activeDisruptionsResult.value.rows[0]
      : null;

    const totalDisruptions  = parseInt(disruptionRow?.total_disruptions || 0);
    const criticalCount     = parseInt(disruptionRow?.critical_count    || 0);
    const warningCount      = parseInt(disruptionRow?.warning_count     || 0);

    // ── Process AQI ──────────────────────────────────────────────────────────
    let avgAqi       = null;
    let aqiReadings  = [];

    if (aqiResults.status === 'fulfilled') {
      aqiResults.value.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          const measurements = result.value.data?.results?.[0]?.measurements || [];
          const pm25 = measurements.find(m => m.parameter === 'pm25');
          if (pm25) {
            aqiReadings.push({ city: KERALA_AQI_CITIES[idx], pm25: pm25.value });
          }
        }
      });

      if (aqiReadings.length > 0) {
        avgAqi = parseFloat(
          (aqiReadings.reduce((s, r) => s + r.pm25, 0) / aqiReadings.length).toFixed(1)
        );
      }
    }

    // ── Process weather advisory ──────────────────────────────────────────────
    let weatherAdvisory = null;

    if (weatherResults.status === 'fulfilled') {
      weatherResults.value.forEach((result, idx) => {
        if (result.status === 'fulfilled' && !weatherAdvisory) {
          const condition = result.value.data?.weather?.[0]?.main || '';
          if (SEVERE_CONDITIONS.some(s => condition.includes(s))) {
            weatherAdvisory = {
              city:      KERALA_WEATHER_COORDS[idx].city,
              condition,
              message:   `${condition} conditions reported in ${KERALA_WEATHER_COORDS[idx].city}. Exercise caution while travelling.`
            };
          }
        }
      });
    }

    res.json({
      totalActiveRoutes,
      disruptions: {
        total:    totalDisruptions,
        critical: criticalCount,
        warning:  warningCount
      },
      aqi: {
        average:  avgAqi,
        readings: aqiReadings,
        unit:     'µg/m³'
      },
      weatherAdvisory,
      timestamp: new Date().toISOString()
    });

  } catch (err) { next(err); }
});

module.exports = router;