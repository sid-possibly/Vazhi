// routes/adminRoutes.js
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Simple admin guard — checks for a hardcoded admin flag on the JWT.
// To use: add { isAdmin: true } to the JWT payload when minting tokens for admin users,
// or store a role field in MongoDB and check it here.
const isAdmin = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

router.use(protect);
// Uncomment the line below before production to lock down admin routes:
// router.use(isAdmin);

// ── GET /api/admin/cities ─────────────────────────────────────────────────────
router.get('/cities', async (req, res, next) => {
  try {
    const { rows } = await req.pool.query('SELECT * FROM cities ORDER BY name ASC');
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/admin/cities ────────────────────────────────────────────────────
router.post('/cities', async (req, res, next) => {
  const { name, slug, lat, lng } = req.body;
  if (!name || !slug || lat == null || lng == null) {
    return res.status(400).json({ error: 'name, slug, lat, and lng are required.' });
  }
  try {
    const { rows } = await req.pool.query(`
      INSERT INTO cities (name, slug, center_coords)
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326))
      RETURNING *
    `, [name, slug, lat, lng]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/admin/modes ─────────────────────────────────────────────────────
router.post('/modes', async (req, res, next) => {
  const { cityId, type, dataSourceUrl } = req.body;
  if (!cityId || !type) {
    return res.status(400).json({ error: 'cityId and type are required.' });
  }
  try {
    const { rows } = await req.pool.query(`
      INSERT INTO transport_modes (city_id, type, data_source_url)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [cityId, type, dataSourceUrl || null]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── GET /api/admin/health ─────────────────────────────────────────────────────
router.get('/health', async (req, res, next) => {
  try {
    const dbCheck    = await req.pool.query('SELECT NOW()');
    const redisCheck = await req.redis.ping(); // ← fixed: was req.io.redis
    res.json({
      status:   'UP',
      database: dbCheck.rows[0].now,
      redis:    redisCheck,
      uptime:   process.uptime()
    });
  } catch (err) { next(err); }
});

module.exports = router;