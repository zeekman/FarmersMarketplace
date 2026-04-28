const cache = require('../cache');
const { err } = require('./error');

/**
 * Per-user rate limiter using cache layer
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Function} Express middleware
 */
function createPerUserRateLimiter(maxRequests, windowMs) {
  return async (req, res, next) => {
    if (!req.user) return err(res, 401, 'Authentication required', 'missing_token');

    const key = `ratelimit:${req.user.id}:${req.path}`;
    const current = await cache.get(key);
    const count = (current?.count || 0) + 1;
    const ttl = Math.ceil(windowMs / 1000);

    if (count > maxRequests) {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', retryAfter.toString());
      return err(res, 429, 'Too many requests, try again later', 'rate_limited', {
        retryAfter,
      });
    }

    await cache.set(key, { count }, ttl);
    next();
  };
}

module.exports = createPerUserRateLimiter;
