// server.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { Pool }   = require('pg');
const cors       = require('cors');
const axios      = require('axios');

// Internal imports
const { findShortestPath } = require('./utils/routingEngine');
const { fetchWithRetry }   = require('./utils/apiWrapper');
const { initCronJobs }     = require('./services/cronJobs');
const graphService         = require('./services/graphService');
const { getRedisClient }   = require('./services/redisClient');
const { initGtfsPoller }   = require('./services/gtfsPoller');

const app    = express();
const server = http.createServer(app); // Wrap express in an HTTP server for Socket.io

// Socket.io server — attached to the same HTTP server
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

console.log('🛠️  Vazhi Backend Starting...');

const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = getRedisClient();

// Kochi city UUID — poller needs this to scope its queries
const KOCHI_CITY_ID = 'e79757c5-93d1-4230-85e3-90998123061c';

// ==========================================
// SOCKET.IO CONNECTION HANDLER
// ==========================================

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ==========================================
// 1. JOURNEY PLANNER
// ==========================================

app.post('/api/journey/plan', async (req, res) => {
  const { startStopId, endStopId, cityId } = req.body;

  if (!startStopId || !endStopId || !cityId) {
    return res.status(400).json({
      error: 'Missing required fields: startStopId, endStopId, cityId'
    });
  }

  console.log(`🔍 Journey Request: ${startStopId} → ${endStopId} (City: ${cityId})`);

  try {
    const graph = await graphService.getGraph(pool, cityId);

    console.log(`📊 Graph ready with ${Object.keys(graph).length} stops`);

    if (Object.keys(graph).length === 0) {
      return res.status(404).json({ error: 'No transit data available for this city.' });
    }

    if (!graph[startStopId]) {
      return res.status(404).json({
        error: `Start stop '${startStopId}' not found in transit graph.`
      });
    }

    const result = findShortestPath(graph, startStopId, endStopId);

    if (result.totalTime === Infinity || result.path.length === 0) {
      console.warn(`❌ No path found between ${startStopId} and ${endStopId}`);
      return res.status(404).json({
        error: 'No path found between these stops. Try different stops or check data ingestion.'
      });
    }

    res.json({
      origin: startStopId,
      destination: endStopId,
      optimalPath: result.path,
      totalTravelTimeMinutes: parseFloat(result.totalTime).toFixed(2),
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('🔥 Journey Planner Error:', err.message);
    res.status(500).json({
      error: 'Internal Server Error while planning journey',
      details: err.message
    });
  }
});

// ==========================================
// 2. LIVE VEHICLE POSITIONS
// Reads latest positions from Redis cache.
// ==========================================

app.get('/api/live/positions/:cityId', async (req, res) => {
  const { cityId } = req.params;

  try {
    // Scan Redis for all position keys matching this city's routes
    const keys = await redis.keys('pos:*');

    if (keys.length === 0) {
      return res.json({ cityId, positions: [], message: 'No active vehicles at this time.' });
    }

    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();

    const positions = results
      .map(([err, val]) => (err || !val ? null : JSON.parse(val)))
      .filter(Boolean);

    res.json({ cityId, positions, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error('Live positions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch live positions' });
  }
});

// ==========================================
// 3. INTELLIGENCE LAYERS
// ==========================================

app.get('/api/intelligence/aqi', async (req, res) => {
  const { city = 'Kochi' } = req.query;
  try {
    const response = await fetchWithRetry(() =>
      axios.get('https://api.openaq.org/v2/latest', {
        params: { city, parameter: ['pm25', 'pm10'] },
        headers: { 'X-API-Key': process.env.OPENAQ_KEY }
      })
    );
    res.json({ city, data: response.data.results });
  } catch (err) {
    console.error('AQI fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch AQI data' });
  }
});

app.get('/api/intelligence/weather', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  try {
    const response = await fetchWithRetry(() =>
      axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: { lat, lon: lng, appid: process.env.WEATHER_KEY, units: 'metric' }
      })
    );
    res.json({
      temp: response.data.main.temp,
      condition: response.data.weather[0].main,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    res.status(503).json({ error: 'Weather service unavailable' });
  }
});

// ==========================================
// 4. CITIZEN REPORTS
// ==========================================

app.post('/api/reports', async (req, res) => {
  let { userId, category, description, lat, lng } = req.body;

  if (!userId || !category || !description || !lat || !lng) {
    return res.status(400).json({ error: 'Missing required report fields' });
  }

  // Sanitize description — strip HTML tags
  description = description.replace(/<[^>]*>?/gm, '').trim();

  try {
    const result = await pool.query(
      `INSERT INTO citizen_reports (user_id_ref, category, description, location)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
       RETURNING *`,
      [userId, category, description, lng, lat]
    );

    const report = result.rows[0];

    // Broadcast new report to all connected clients in real-time
    io.emit('new_report', report);

    res.status(201).json(report);
  } catch (err) {
    console.error('Citizen report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. SERVER STARTUP
// ==========================================

const PORT = process.env.PORT || 5000;

// Use server.listen (not app.listen) so Socket.io shares the same port
server.listen(PORT, () => {
  console.log(`✅ Vazhi Intelligence Engine running on http://localhost:${PORT}`);
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Database Connection Error:', err.stack);
  }
  console.log('✅ Successfully connected to PostgreSQL + PostGIS');

  // Initialize background cron jobs (report expiry)
  initCronJobs(pool);

  // Initialize GTFS position poller — broadcasts every 15s via Socket.io
  initGtfsPoller(pool, KOCHI_CITY_ID, redis, io);

  release();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  pool.end();
  redis.quit();
  process.exit(0);
});