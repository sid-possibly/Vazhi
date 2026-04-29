// routes/reportsRoutes.js
// Citizen report endpoints:
//   GET  /api/reports          — fetch reports near a location
//   POST /api/reports          — file a new report (protected)
//   POST /api/reports/:id/upvote — upvote a report (protected)

const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/authMiddleware');

// ==========================================
// GET /api/reports
// Fetch active citizen reports near a location.
// Required query params: lat, lng
// Optional: radius (metres, default 2000), limit (default 50)
// ==========================================

router.get('/', async (req, res) => {
  const { lat, lng, radius = 2000, limit = 50 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }

  try {
    const { rows } = await req.pool.query(`
      SELECT
        report_id,
        user_id_ref,
        category,
        description,
        upvotes,
        expires_at,
        created_at,
        ST_Y(location) AS lat,
        ST_X(location) AS lng,
        ST_Distance(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) AS distance_metres
      FROM citizen_reports
      WHERE
        ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
        AND expires_at > NOW()
      ORDER BY distance_metres ASC
      LIMIT $4
    `, [parseFloat(lat), parseFloat(lng), parseInt(radius), parseInt(limit)]);

    res.json({
      total: rows.length,
      reports: rows.map(row => ({
        reportId:       row.report_id,
        userId:         row.user_id_ref,
        category:       row.category,
        description:    row.description,
        upvotes:        row.upvotes,
        expiresAt:      row.expires_at,
        createdAt:      row.created_at,
        lat:            parseFloat(row.lat),
        lng:            parseFloat(row.lng),
        distanceMetres: Math.round(parseFloat(row.distance_metres))
      }))
    });

  } catch (err) {
    console.error('Reports feed error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ==========================================
// POST /api/reports
// File a new citizen report.
// Requires JWT auth.
// ==========================================

router.post('/', protect, async (req, res) => {
  let { category, description, lat, lng } = req.body;
  const userId = req.user.userId; // from JWT

  if (!category || !description || !lat || !lng) {
    return res.status(400).json({ error: 'category, description, lat and lng are required.' });
  }

  const validCategories = ['Overcrowded', 'Infrastructure', 'Missed', 'Unsafe'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({
      error: `category must be one of: ${validCategories.join(', ')}`
    });
  }

  // Sanitize — strip HTML tags
  description = description.replace(/<[^>]*>?/gm, '').trim();

  if (description.length < 5) {
    return res.status(400).json({ error: 'Description too short.' });
  }

  try {
    const { rows } = await req.pool.query(`
      INSERT INTO citizen_reports (user_id_ref, category, description, location)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
      RETURNING
        report_id, user_id_ref, category, description,
        upvotes, expires_at, created_at,
        ST_Y(location) AS lat, ST_X(location) AS lng
    `, [userId, category, description, parseFloat(lng), parseFloat(lat)]);

    const report = rows[0];

    // Broadcast to all connected Socket.io clients
    req.io.emit('new_report', report);

    res.status(201).json(report);

  } catch (err) {
    console.error('File report error:', err.message);
    res.status(500).json({ error: 'Failed to file report.' });
  }
});

// ==========================================
// POST /api/reports/:reportId/upvote
// Upvote a citizen report.
// Requires JWT auth.
// ==========================================

router.post('/:reportId/upvote', protect, async (req, res) => {
  const { reportId } = req.params;

  try {
    const { rows } = await req.pool.query(`
      UPDATE citizen_reports
      SET upvotes = upvotes + 1
      WHERE report_id = $1
        AND expires_at > NOW()
      RETURNING report_id, upvotes
    `, [reportId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Report not found or has expired.' });
    }

    res.json({
      reportId: rows[0].report_id,
      upvotes:  rows[0].upvotes
    });

  } catch (err) {
    console.error('Upvote error:', err.message);
    res.status(500).json({ error: 'Failed to upvote report.' });
  }
});

module.exports = router;