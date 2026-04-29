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

/**
 * Structured error logging middleware — logs route errors with request context
 * @param {Error} error
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode || 500,
      stack: error.stack,
    },
    request: {
      id: req.requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    },
  };

  logger.error('Unhandled error', errorLog);
  
  const status = error.statusCode || 500;
  const message = error.message || 'Internal server error';
  return err(res, status, message, error.code);
}

module.exports = { err, errorHandler };
