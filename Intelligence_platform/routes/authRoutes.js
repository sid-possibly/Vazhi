// routes/authRoutes.js
const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');

const User         = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const {
  validateRegister,
  validateLogin,
  validateRefresh
} = require('../middleware/validation');

// ── Token helpers ─────────────────────────────────────────────────────────────

const generateAccessToken = (user) =>
  jwt.sign(
    { userId: user._id, email: user.email },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );

const generateRefreshToken = () =>
  crypto.randomBytes(64).toString('hex');

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// ── POST /api/auth/register ───────────────────────────────────────────────────

router.post('/register', validateRegister, async (req, res, next) => {
  const { name, email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    const user = new User({ name, email, password_hash: password });
    await user.save();
    res.status(201).json({
      message: 'Account created successfully.',
      userId:  user._id,
      name:    user.name,
      email:   user.email
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', validateLogin, async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const familyId     = crypto.randomUUID();

    await RefreshToken.create({
      user_id:    user._id,
      family_id:  familyId,
      token_hash: hashToken(refreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    res.json({
      accessToken,
      refreshToken,
      user: { userId: user._id, name: user.name, email: user.email }
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────

router.post('/refresh', validateRefresh, async (req, res, next) => {
  const { refreshToken } = req.body;
  try {
    const tokenHash = hashToken(refreshToken);
    const stored    = await RefreshToken.findOne({ token_hash: tokenHash });

    if (!stored) {
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }
    if (stored.is_revoked) {
      await RefreshToken.updateMany({ family_id: stored.family_id }, { is_revoked: true });
      return res.status(401).json({ error: 'Token reuse detected. Please log in again.' });
    }
    if (stored.expires_at < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired. Please log in again.' });
    }

    stored.is_revoked = true;
    await stored.save();

    const user            = await User.findById(stored.user_id);
    const accessToken     = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();

    await RefreshToken.create({
      user_id:    user._id,
      family_id:  stored.family_id,
      token_hash: hashToken(newRefreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', async (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required.' });
  }
  try {
    await RefreshToken.findOneAndUpdate(
      { token_hash: hashToken(refreshToken) },
      { is_revoked: true }
    );
    res.json({ message: 'Logged out successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;