// routes/authRoutes.js
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');

const User         = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

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

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const user = new User({ name, email, password_hash: password });
    await user.save();

    res.status(201).json({
      message: 'Account created successfully.',
      userId: user._id,
      name: user.name,
      email: user.email
    });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate tokens
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const familyId     = crypto.randomUUID();

    // Store hashed refresh token in MongoDB
    await RefreshToken.create({
      user_id:    user._id,
      family_id:  familyId,
      token_hash: hashToken(refreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        userId: user._id,
        name:   user.name,
        email:  user.email
      }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
// Refresh token rotation with family revocation on reuse detection.

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required.' });
  }

  try {
    const tokenHash = hashToken(refreshToken);
    const stored    = await RefreshToken.findOne({ token_hash: tokenHash });

    // Token not found
    if (!stored) {
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }

    // Token reuse detected — revoke entire family (possible token theft)
    if (stored.is_revoked) {
      await RefreshToken.updateMany(
        { family_id: stored.family_id },
        { is_revoked: true }
      );
      return res.status(401).json({ error: 'Token reuse detected. Please log in again.' });
    }

    // Token expired
    if (stored.expires_at < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired. Please log in again.' });
    }

    // Revoke the old token
    stored.is_revoked = true;
    await stored.save();

    // Issue new tokens
    const user         = await User.findById(stored.user_id);
    const accessToken  = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();

    await RefreshToken.create({
      user_id:    user._id,
      family_id:  stored.family_id, // Keep same family
      token_hash: hashToken(newRefreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    res.json({ accessToken, refreshToken: newRefreshToken });

  } catch (err) {
    console.error('Refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required.' });
  }

  try {
    const tokenHash = hashToken(refreshToken);
    await RefreshToken.findOneAndUpdate(
      { token_hash: tokenHash },
      { is_revoked: true }
    );

    res.json({ message: 'Logged out successfully.' });

  } catch (err) {
    console.error('Logout error:', err.message);
    res.status(500).json({ error: 'Logout failed.' });
  }
});

module.exports = router;