// routes/userRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { validateRouteAction } = require('../middleware/validation');
const User = require('../models/User');

router.use(protect);

// ── GET /api/user/profile ─────────────────────────────────────────────────────
router.get('/profile', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId).select('-password_hash');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) { next(err); }
});

// ── GET /api/user/dashboard ───────────────────────────────────────────────────
// Aggregates saved routes with live Redis status + user's own reports.
router.get('/dashboard', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // 1. Own citizen reports from Postgres
    const { rows: ownReports } = await req.pool.query(`
      SELECT report_id, category, description, upvotes, created_at, expires_at
      FROM citizen_reports
      WHERE user_id_ref = $1
      ORDER BY created_at DESC
    `, [req.user.userId.toString()]);

    // 2. Route details for saved routes
    const { rows: routeDetails } = await req.pool.query(`
      SELECT r.gtfs_route_id, r.route_short_name, r.route_color, tm.type AS mode
      FROM routes r
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE r.gtfs_route_id = ANY($1)
    `, [user.saved_routes.length > 0 ? user.saved_routes : ['__none__']]);

    // 3. Live status from Redis — use req.redis (injected in server.js)
    let liveStatus = [];
    if (user.saved_routes.length > 0) {
      const pipeline = req.redis.pipeline(); // ← fixed: was req.io.redis
      user.saved_routes.forEach(id => pipeline.keys(`pos:${id}:*`));
      const keyGroups = await pipeline.exec();

      liveStatus = await Promise.all(
        keyGroups.map(async ([err, keys], idx) => {
          const routeId = user.saved_routes[idx];
          if (err || !keys || keys.length === 0) {
            return { routeId, status: 'No active trips', delayMinutes: 0 };
          }
          try {
            const posData = await req.redis.get(keys[0]); // ← fixed
            const parsed  = JSON.parse(posData);
            return {
              routeId,
              status:       parsed.delayMinutes > 5 ? 'Delayed' : 'On Time',
              delayMinutes: parsed.delayMinutes
            };
          } catch {
            return { routeId, status: 'No active trips', delayMinutes: 0 };
          }
        })
      );
    }

    res.json({
      profile:    { name: user.name, email: user.email },
      savedRoutes: routeDetails.map(r => ({
        ...r,
        live: liveStatus.find(l => l.routeId === r.gtfs_route_id) || { status: 'No active trips' }
      })),
      alertPrefs: user.alert_prefs,
      ownReports
    });
  } catch (err) { next(err); }
});

// ── POST /api/user/push-subscription ─────────────────────────────────────────
router.post('/push-subscription', async (req, res, next) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid push subscription object.' });
  }
  try {
    await User.findByIdAndUpdate(req.user.userId, { push_subscription: subscription });
    res.json({ message: 'Push subscription saved successfully.' });
  } catch (err) { next(err); }
});

// ── PUT /api/user/saved-routes ────────────────────────────────────────────────
router.put('/saved-routes', validateRouteAction, async (req, res, next) => {
  const { gtfsRouteId, action } = req.body;
  try {
    const update = action === 'add'
      ? { $addToSet: { saved_routes: gtfsRouteId } }
      : { $pull:     { saved_routes: gtfsRouteId } };

    const user = await User.findByIdAndUpdate(req.user.userId, update, { new: true })
      .select('-password_hash');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: `Route ${action}ed successfully.`, savedRoutes: user.saved_routes });
  } catch (err) { next(err); }
});

// ── PUT /api/user/alert-prefs ─────────────────────────────────────────────────
// Add or remove a route from the user's alert subscriptions.
// Body: { gtfsRouteId: string, action: "add" | "remove" }
router.put('/alert-prefs', validateRouteAction, async (req, res, next) => {
  const { gtfsRouteId, action } = req.body;
  try {
    const update = action === 'add'
      ? { $addToSet: { alert_prefs: gtfsRouteId } }
      : { $pull:     { alert_prefs: gtfsRouteId } };

    const user = await User.findByIdAndUpdate(req.user.userId, update, { new: true })
      .select('-password_hash');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: `Alert pref ${action}ed successfully.`, alertPrefs: user.alert_prefs });
  } catch (err) { next(err); }
});

module.exports = router;