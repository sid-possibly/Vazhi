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
  const { userId, category, description, lat, lng } = req.body;
  try {
    const query = `
      INSERT INTO citizen_reports (user_id_ref, category, description, location)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
      RETURNING *;
    `;
    const result = await pool.query(query, [userId, category, description, lng, lat]);
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