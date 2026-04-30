// middleware/errorHandler.js
// Global error handling middleware.
// Catches any unhandled errors thrown in route handlers and
// returns a consistent JSON response instead of crashing or
// returning an HTML Express error page.
//
// Must be registered LAST in server.js — after all routes.

const errorHandler = (err, req, res, next) => {
  // Log full stack in development
  if (process.env.NODE_ENV !== 'production') {
    console.error('🔥 Unhandled Error:', err.stack);
  } else {
    console.error('🔥 Unhandled Error:', err.message);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error:  'Validation failed.',
      errors: Object.values(err.errors).map(e => ({
        field:   e.path,
        message: e.message
      }))
    });
  }

  // Mongoose duplicate key error (e.g. duplicate email)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      error: `An account with this ${field} already exists.`
    });
  }

  // JWT errors (shouldn't reach here normally but just in case)
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired.' });
  }

  // PostgreSQL errors
  if (err.code && err.code.startsWith('23')) {
    return res.status(400).json({ error: 'Database constraint violation.', detail: err.detail });
  }

  // Default 500
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : err.message || 'Internal Server Error'
  });
};

module.exports = { errorHandler };