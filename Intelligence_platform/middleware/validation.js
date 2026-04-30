// middleware/validation.js
// Centralised input validation rules using express-validator.
// Each export is an array of validation rules + the handleValidation
// middleware that converts errors into a consistent 400 response.

const { body, query, param, validationResult } = require('express-validator');

// ── Error handler ─────────────────────────────────────────────────────────────

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error:  'Validation failed.',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

// ── Auth ──────────────────────────────────────────────────────────────────────

const validateRegister = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required.')
    .isLength({ max: 100 }).withMessage('Name must be under 100 characters.'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Must be a valid email address.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .isLength({ max: 128 }).withMessage('Password must be under 128 characters.'),
  handleValidation
];

const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Must be a valid email address.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required.'),
  handleValidation
];

const validateRefresh = [
  body('refreshToken')
    .notEmpty().withMessage('Refresh token is required.')
    .isHexadecimal().withMessage('Invalid refresh token format.')
    .isLength({ min: 64, max: 256 }).withMessage('Invalid refresh token length.'),
  handleValidation
];

// ── Journey planner ───────────────────────────────────────────────────────────

const validateJourneyPlan = [
  body('startStopId')
    .trim()
    .notEmpty().withMessage('startStopId is required.'),
  body('endStopId')
    .trim()
    .notEmpty().withMessage('endStopId is required.'),
  body('cityId')
    .trim()
    .notEmpty().withMessage('cityId is required.')
    .isUUID().withMessage('cityId must be a valid UUID.'),
  handleValidation
];

// ── Citizen reports ───────────────────────────────────────────────────────────

const validateReport = [
  body('category')
    .trim()
    .notEmpty().withMessage('Category is required.')
    .isIn(['Overcrowded', 'Infrastructure', 'Missed', 'Unsafe'])
    .withMessage('Category must be one of: Overcrowded, Infrastructure, Missed, Unsafe.'),
  body('description')
    .trim()
    .notEmpty().withMessage('Description is required.')
    .isLength({ min: 5 }).withMessage('Description must be at least 5 characters.')
    .isLength({ max: 500 }).withMessage('Description must be under 500 characters.'),
  body('lat')
    .notEmpty().withMessage('lat is required.')
    .isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude.'),
  body('lng')
    .notEmpty().withMessage('lng is required.')
    .isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude.'),
  handleValidation
];

// ── Stop search ───────────────────────────────────────────────────────────────

const validateStopSearch = [
  query('q')
    .trim()
    .notEmpty().withMessage('Search query q is required.')
    .isLength({ min: 2 }).withMessage('Query must be at least 2 characters.')
    .isLength({ max: 100 }).withMessage('Query must be under 100 characters.'),
  handleValidation
];

// ── User profile ──────────────────────────────────────────────────────────────

const validateRouteAction = [
  body('gtfsRouteId')
    .trim()
    .notEmpty().withMessage('gtfsRouteId is required.'),
  body('action')
    .trim()
    .notEmpty().withMessage('action is required.')
    .isIn(['add', 'remove']).withMessage('action must be "add" or "remove".'),
  handleValidation
];

module.exports = {
  validateRegister,
  validateLogin,
  validateRefresh,
  validateJourneyPlan,
  validateReport,
  validateStopSearch,
  validateRouteAction,
  handleValidation
};