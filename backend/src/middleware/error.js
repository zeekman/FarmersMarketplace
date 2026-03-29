const logger = require('../logger');

/**
 * Send a unified error response: { success: false, message, code }
 * @param {import('express').Response} res
 * @param {number} status  HTTP status code
 * @param {string} message Human-readable error message
 * @param {string} [code]  Machine-readable error code (defaults to snake_case of message)
 */
function err(res, status, message, code) {
  return res.status(status).json({
    success: false,
    message,
    code: code || message.toLowerCase().replace(/\s+/g, '_'),
  });
}

/** Express 4-arg error handler — mount last in app.js */
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    requestId: req.requestId,
    method: req.method,
    url: req.url
  });
  return err(res, 500, 'Internal server error', 'internal_error');
}

module.exports = { err, errorHandler };
