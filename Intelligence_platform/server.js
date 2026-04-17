const { findShortestPath } = require('./utils/routingEngine');
const { fetchWithRetry } = require('./utils/apiWrapper');
const { initCronJobs } = require('./services/cronJobs');
const { buildGraph } = require('./services/graphService');

const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// POST: Create a new Citizen Report
app.post('/api/reports', async (req, res) => {
  let { userId, category, description, lat, lng } = req.body;
  
  // Basic Sanitization 
  description = description.replace(/<[^>]*>?/gm, ''); // Remove HTML tags

  try {
    const query = `
      INSERT INTO citizen_reports (user_id_ref, category, description, location)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
      RETURNING *;
    `;
    const result = await pool.query(query, [userId, category, description, lng, lat]);
    
    // NOTE: Once Member 3 is ready, you will add the Socket.io emit here [cite: 161]
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Find reports within 300m of a point (Intelligence Logic)
app.get('/api/reports/nearby', async (req, res) => {
  const { lat, lng, radius = 300 } = req.query;
  try {
    const query = `
      SELECT *, ST_AsGeoJSON(location)::json as coords
      FROM citizen_reports
      WHERE ST_DWithin(
        location, 
        ST_SetSRID(ST_MakePoint($1, $2), 4326), 
        $3
      ) AND expires_at > NOW();
    `;
    const result = await pool.query(query, [lng, lat, radius]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT, () => console.log(`Intelligence Engine running on port ${process.env.PORT}`));

pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  console.log('Successfully connected to PostgreSQL/PostGIS');
  
  // Initialize Task 15: Background Cron Jobs here 
  initCronJobs(pool); 
  
  release();
});

const axios = require('axios'); // Run 'npm install axios' first

app.get('/api/intelligence/aqi', async (req, res) => {
  const { city = 'Kochi' } = req.query;
  try {
    // OpenAQ API call for PM2.5 and PM10 [cite: 201]
    const response = await axios.get(`https://api.openaq.org/v2/latest`, {
      params: { city: city, parameter: ['pm25', 'pm10'] },
      headers: { 'X-API-Key': process.env.OPENAQ_KEY } // Add this key to your .env later
    });

    res.json({
      city: city,
      timestamp: new Date(),
      data: response.data.results
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch AQI data' });
  }
});

// GET: Weather Intelligence Layer 
app.get('/api/intelligence/weather', async (req, res) => {
  const { lat, lng } = req.query;
  try {
    // Use the safety wrapper for Task 20 
    const response = await fetchWithRetry(() => axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
      params: {
        lat: lat,
        lon: lng,
        appid: process.env.WEATHER_KEY,
        units: 'metric'
      }
    }));

    // Keep your normalization logic for Task 8 [cite: 148, 191]
    res.json({
      location: response.data.name, 
      temp: response.data.main.temp, 
      condition: response.data.weather[0].main, 
      description: response.data.weather[0].description,
      timestamp: new Date()
    });
  } catch (err) {
    // Use 503 (Service Unavailable) to show it's an external API issue 
    res.status(503).json({ error: 'Weather service temporarily unavailable' });
  }
});

// GET: Traffic Intelligence Layer [cite: 149, 203]
app.get('/api/intelligence/traffic', async (req, res) => {
  const { lat, lng } = req.query;
  try {
    const response = await axios.get(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`, {
      params: {
        key: process.env.TOMTOM_KEY,
        point: `${lat},${lng}`
      }
    });

    const flow = response.data.flowSegmentData;
    // Normalize response for Member 2 (Frontend)
    res.json({
      type: 'Traffic',
      severity: (flow.currentSpeed / flow.freeFlowSpeed) < 0.5 ? 'Critical' : 'Info',
      displayValue: `${flow.currentSpeed} km/h`,
      timestamp: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: 'Traffic API failure' });
  }
});

// Fetch connections between stops to build the routing graph 
const getTransitEdges = async (cityId) => {
  const query = `
    SELECT 
      s1.stop_id AS source, 
      s2.stop_id AS target, 
      (s2.arrival_time - s1.departure_time) AS travel_time -- Edge Weight
    FROM schedules s1
    JOIN schedules s2 ON s1.trip_id = s2.trip_id 
      AND s1.stop_sequence = s2.stop_sequence - 1
    JOIN stops st ON s1.stop_id = st.stop_id
    WHERE st.city_id = $1;
  `;
  const result = await pool.query(query, [cityId]);
  return result.rows;
};