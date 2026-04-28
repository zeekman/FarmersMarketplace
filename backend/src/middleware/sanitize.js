/**
 * Middleware to strip sensitive fields from API responses
 * This is a safety net to ensure stellar_secret_key and password are never exposed
 */

const SENSITIVE_FIELDS = ['stellar_secret_key', 'password'];

/**
 * Recursively strip sensitive fields from an object
 */
function stripSensitiveFields(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => stripSensitiveFields(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!SENSITIVE_FIELDS.includes(key)) {
      sanitized[key] = stripSensitiveFields(value);
    }
  }
  return sanitized;
}

/**
 * Middleware to sanitize response JSON
 */
function sanitizeResponse(req, res, next) {
  const originalJson = res.json;

  res.json = function (data) {
    const sanitized = stripSensitiveFields(data);
    return originalJson.call(this, sanitized);
  };

  next();
}

module.exports = { sanitizeResponse, stripSensitiveFields };
