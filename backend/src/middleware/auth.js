const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const cache = require('../cache');
const { err } = require('./error');

const AUTH_STATUS_TTL_SECONDS = 30;

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return err(res, 401, 'No token provided', 'missing_token');

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    });
    // Reject tokens minted for another purpose (e.g. the short-lived SSE
    // stream token from GET /auth/stream-token) so they can't be replayed
    // here as a full access token.
    if (req.user.scope === 'stream' || (req.user.typ && req.user.typ !== 'access')) {
      return err(res, 401, 'Invalid token', 'invalid_token');
    }
    // Check if user is still active and not banned, caching the lookup so the
    // hot path doesn't hit the DB on every request.
    const cacheKey = `auth:status:${req.user.id}`;
    let status = await cache.get(cacheKey);
    if (!status) {
      const { rows } = await db.query('SELECT active, banned_at FROM users WHERE id = $1', [req.user.id]);
      const user = rows[0] || {};
      status = { active: user.active, banned: !!user.banned_at };
      await cache.set(cacheKey, status, AUTH_STATUS_TTL_SECONDS);
    }
    if (status.active !== 1 || status.banned) {
      return err(res, 401, 'Account deactivated', 'deactivated');
    }
    // Defence in depth: authenticated responses must never be stored by
    // shared caches (service worker, proxies, browsers).
    res.set('Cache-Control', 'private, no-store');
    next();
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError)
      return err(res, 401, 'Token expired', 'token_expired');
    err(res, 401, 'Invalid token', 'invalid_token');
  }
};
