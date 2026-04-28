const logger = require('../logger');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Send a unified error response: { success: false, error, message, code }
 */
function err(res, status, message, code) {
  return res.status(status).json({
    success: false,
    error: code || message.toLowerCase().replace(/\s+/g, '_'),
    message,
    code: code || message.toLowerCase().replace(/\s+/g, '_'),
  });
}

/**
 * Wrap async route handlers to forward errors to the global error handler.
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Global Express error handler — must be registered as the last middleware in app.js.
 * Handles: Mongoose/SQLite validation, duplicate key, CastError, JWT, Zod, and generic errors.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  logger.error('Unhandled error', {
    error: error.message,
    stack: isProd ? undefined : error.stack,
    method: req.method,
    url: req.url,
  });

  // Zod validation errors
  if (error.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: 'validation_error',
      message: error.errors?.[0]?.message || 'Validation failed',
      details: error.errors,
      ...(isProd ? {} : { stack: error.stack }),
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    });
  }

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const details = Object.values(error.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      error: 'validation_error',
      message: 'Validation failed',
      details,
      ...(isProd ? {} : { stack: error.stack }),
    });
  }

  // Mongoose duplicate key (code 11000) or SQLite UNIQUE constraint
  if (error.code === 11000 || (error.message && error.message.includes('UNIQUE constraint failed'))) {
    const field = error.keyValue
      ? Object.keys(error.keyValue)[0]
      : (error.message.match(/UNIQUE constraint failed: \w+\.(\w+)/)?.[1] || 'field');
    return res.status(409).json({
      success: false,
      error: 'conflict',
      message: `Duplicate value for field: ${field}`,
      field,
    });
  }

  // Mongoose CastError (invalid ObjectId) or SQLite bad integer
  if (error.name === 'CastError' || (error.message && /invalid input syntax for type integer/i.test(error.message))) {
    return res.status(400).json({
      success: false,
      error: 'invalid_id',
      message: 'Invalid ID format',
      ...(isProd ? {} : { stack: error.stack }),
    });
  }

  // Default 500
  return res.status(error.status || 500).json({
    success: false,
    error: 'internal_error',
    message: isProd ? 'Internal server error' : error.message,
    ...(isProd ? {} : { stack: error.stack }),
  });
}

/**
 * 404 handler — mount after all routes, before errorHandler.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'not_found',
    message: `Route not found: ${req.method} ${req.path}`,
  });
  return err(res, 500, 'Internal server error', 'internal_error');
}

module.exports = { err, asyncHandler, errorHandler, notFoundHandler };
