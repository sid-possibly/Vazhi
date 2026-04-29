// routes/userRoutes.js
// User profile endpoints — all protected by JWT.
//
//   GET  /api/user/profile          — fetch profile
//   PUT  /api/user/saved-routes     — add or remove a saved route
//   PUT  /api/user/alert-prefs      — update alert preferences

const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User       = require('../models/User');

// All routes in this file require authentication
router.use(protect);

// ==========================================
// GET /api/user/profile
// Returns the logged-in user's profile.
// ==========================================

router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password_hash');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      userId:      user._id,
      name:        user.name,
      email:       user.email,
      savedRoutes: user.saved_routes,
      alertPrefs:  user.alert_prefs,
      createdAt:   user.createdAt
    });

  } catch (err) {
    console.error('Profile fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ==========================================
// PUT /api/user/saved-routes
// Add or remove a route from saved routes.
//
// Body: { gtfsRouteId: "R1", action: "add" | "remove" }
// ==========================================

router.put('/saved-routes', async (req, res) => {
  const { gtfsRouteId, action } = req.body;

  if (!gtfsRouteId || !action) {
    return res.status(400).json({ error: 'gtfsRouteId and action are required.' });
  }

  if (!['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'action must be "add" or "remove".' });
  }

  try {
    const update = action === 'add'
      ? { $addToSet: { saved_routes: gtfsRouteId } } // addToSet prevents duplicates
      : { $pull:     { saved_routes: gtfsRouteId } };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      update,
      { new: true }  // Return updated document
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      message:     `Route ${action === 'add' ? 'saved' : 'removed'} successfully.`,
      savedRoutes: user.saved_routes
    });

  } catch (err) {
    console.error('Saved routes error:', err.message);
    res.status(500).json({ error: 'Failed to update saved routes.' });
  }
});

// ==========================================
// PUT /api/user/alert-prefs
// Update which routes the user wants alerts for.
//
// Body: { gtfsRouteId: "R1", action: "add" | "remove" }
// ==========================================

router.put('/alert-prefs', async (req, res) => {
  const { gtfsRouteId, action } = req.body;

  if (!gtfsRouteId || !action) {
    return res.status(400).json({ error: 'gtfsRouteId and action are required.' });
  }

  if (!['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'action must be "add" or "remove".' });
  }

  try {
    const update = action === 'add'
      ? { $addToSet: { alert_prefs: gtfsRouteId } }
      : { $pull:     { alert_prefs: gtfsRouteId } };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      update,
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      message:    `Alert preference ${action === 'add' ? 'added' : 'removed'} successfully.`,
      alertPrefs: user.alert_prefs
    });

  } catch (err) {
    console.error('Alert prefs error:', err.message);
    res.status(500).json({ error: 'Failed to update alert preferences.' });
  }
});

module.exports = router;