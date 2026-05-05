// routes/intelligenceRoutes.js
// Intelligence layer endpoints:
//   GET /api/intelligence/aqi
//   GET /api/intelligence/weather
//   GET /api/intelligence/traffic

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { fetchWithRetry } = require('../utils/apiWrapper');

// ── GET /api/intelligence/aqi ─────────────────────────────────────────────────

router.get('/aqi', async (req, res, next) => {
  const { city = 'Kochi' } = req.query;
  try {
    const response = await fetchWithRetry(() =>
      axios.get('https://api.openaq.org/v2/latest', {
        params:  { city, parameter: ['pm25', 'pm10', 'no2'] },
        headers: { 'X-API-Key': process.env.OPENAQ_KEY }
      })
    );
    res.json({ city, data: response.data.results });
  } catch (err) { next(err); }
});

// ── GET /api/intelligence/weather ─────────────────────────────────────────────

router.get('/weather', async (req, res, next) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }
  try {
    const response = await fetchWithRetry(() =>
      axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: { lat, lon: lng, appid: process.env.WEATHER_KEY, units: 'metric' }
      })
    );
    res.json({
      temp:        response.data.main.temp,
      feelsLike:   response.data.main.feels_like,
      humidity:    response.data.main.humidity,
      condition:   response.data.weather[0].main,
      description: response.data.weather[0].description,
      windSpeed:   response.data.wind.speed,
      timestamp:   new Date().toISOString()
    });
  } catch (err) { next(err); }
});

// ── GET /api/intelligence/traffic ─────────────────────────────────────────────
// Returns TomTom traffic flow data for a bounding box around the given
// coordinates. The frontend uses this to render a congestion heatmap layer.
//
// TomTom Flow Segment Data API:
// https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json
//   ?point={lat},{lng}
//   &key={API_KEY}
//
// For a heatmap, we sample a grid of points around the centre coordinate.
// Grid: 5x5 = 25 points, spaced ~500m apart (~0.0045 degrees).

router.get('/traffic', async (req, res, next) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }

  const centerLat = parseFloat(lat);
  const centerLng = parseFloat(lng);
  const STEP      = 0.0045; // ~500m
  const GRID_SIZE = 3;      // 3x3 grid = 9 points (avoids TomTom rate limits)

  // Build grid of sample points
  const points = [];
  for (let i = -Math.floor(GRID_SIZE / 2); i <= Math.floor(GRID_SIZE / 2); i++) {
    for (let j = -Math.floor(GRID_SIZE / 2); j <= Math.floor(GRID_SIZE / 2); j++) {
      points.push({
        lat: centerLat + i * STEP,
        lng: centerLng + j * STEP
      });
    }
  }

  try {
    // Fetch traffic flow for each grid point in parallel
    const results = await Promise.allSettled(
      points.map(pt =>
        axios.get(
          `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`,
          {
            params: {
              point: `${pt.lat},${pt.lng}`,
              key:   process.env.TOMTOM_KEY
            },
            timeout: 5000
          }
        )
      )
    );

    const heatmapPoints = [];

    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const data = result.value.data?.flowSegmentData;
        if (data) {
          const currentSpeed = data.currentSpeed;
          const freeFlowSpeed = data.freeFlowSpeed;
          // Congestion ratio: 0 = free flow, 1 = completely congested
          const congestion = freeFlowSpeed > 0
            ? Math.max(0, Math.min(1, 1 - (currentSpeed / freeFlowSpeed)))
            : 0;

          heatmapPoints.push({
            lat:          points[idx].lat,
            lng:          points[idx].lng,
            currentSpeed,
            freeFlowSpeed,
            congestion:   parseFloat(congestion.toFixed(2)),
            // Confidence: 0-1 from TomTom
            confidence:   data.confidence || 1
          });
        }
      }
    });

    res.json({
      center:        { lat: centerLat, lng: centerLng },
      heatmapPoints,
      totalPoints:   heatmapPoints.length,
      timestamp:     new Date().toISOString()
    });

  } catch (err) { next(err); }
});

module.exports = router;