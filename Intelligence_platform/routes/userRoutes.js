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
    res.json({
      userId:      user._id,
      name:        user.name,
      email:       user.email,
      savedRoutes: user.saved_routes,
      alertPrefs:  user.alert_prefs,
      createdAt:   user.createdAt
    });
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

    res.json({
      message:     `Route ${action === 'add' ? 'saved' : 'removed'} successfully.`,
      savedRoutes: user.saved_routes
    });
  } catch (err) { next(err); }
});

// ── PUT /api/user/alert-prefs ─────────────────────────────────────────────────

router.put('/alert-prefs', validateRouteAction, async (req, res, next) => {
  const { gtfsRouteId, action } = req.body;
  try {
    const update = action === 'add'
      ? { $addToSet: { alert_prefs: gtfsRouteId } }
      : { $pull:     { alert_prefs: gtfsRouteId } };

    const user = await User.findByIdAndUpdate(req.user.userId, update, { new: true })
      .select('-password_hash');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({
      message:    `Alert preference ${action === 'add' ? 'added' : 'removed'} successfully.`,
      alertPrefs: user.alert_prefs
    });
  } catch (err) { next(err); }
});

module.exports = router;