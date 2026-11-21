/**
 * rateLimitPerUser.js
 *
 * Rate limiters for per-user and per-IP enforcement.
 *
 * REDIS (when available via cache.isReady()):
 *   Uses a Redis-backed fixed-window counter (INCR + PEXPIRE).
 *   Safe for distributed traffic across multiple app replicas.
 *
 * IN-MEMORY FALLBACK:
 *   A module-level Map stores fixed-window counters per key.
 *   Entries are evicted automatically when their window expires.
 *
 * RESPONSE ON VIOLATION:
 *   HTTP 429 with { code: 'rate_limit_exceeded' }
 *   Headers: RateLimit-Limit, RateLimit-Remaining, Retry-After
 */

const { err } = require('./error');
const logger = require('../logger');
const cache = require('../cache');

// In-memory fixed-window store: key -> { count, expiresAt }
const memoryStore = new Map();

function sweepMemoryStore() {
  const now = Date.now();
  for (const [key, data] of memoryStore) {
    if (data.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}

// Frequent sweep to ensure memory doesn't grow unbounded.
let sweepTimer = setInterval(sweepMemoryStore, 60000);
if (sweepTimer.unref) sweepTimer.unref();

/**
 * Redis-backed fixed-window rate limit check.
 */
async function redisLimit(client, key, maxRequests, windowMs) {
  const multi = client.multi();
  multi.incr(key);
  multi.pttl(key);
  const [incrResult, pttlResult] = await multi.exec();

  const count = incrResult[1];
  let pttl = pttlResult[1];

  // If this is a new key (PTTL is -1), set the expiration
  if (pttl < 0) {
    await client.pexpire(key, windowMs);
    pttl = windowMs;
  }

  return {
    allowed: count <= maxRequests,
    count,
    retryAfterMs: count > maxRequests ? Math.max(0, pttl) : 0,
  };
}

/**
 * In-memory fixed-window rate limit check.
 */
function memoryLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let data = memoryStore.get(key);

  if (!data || data.expiresAt <= now) {
    data = { count: 0, expiresAt: now + windowMs };
  }

  data.count += 1;
  memoryStore.set(key, data);

  const retryAfterMs = data.count > maxRequests ? Math.max(0, data.expiresAt - now) : 0;

  return {
    allowed: data.count <= maxRequests,
    count: data.count,
    retryAfterMs,
  };
}

async function checkRateLimit(key, maxRequests, windowMs) {
  if (cache.isReady()) {
    try {
      const client = cache.client;
      return await redisLimit(client, key, maxRequests, windowMs);
    } catch (e) {
      logger.debug('[ratelimit] Redis operation failed, falling back to memory', { error: e.message });
    }
  }
  return memoryLimit(key, maxRequests, windowMs);
}

function setStandardHeaders(res, maxRequests, count, retryAfterMs) {
  res.set('RateLimit-Limit', String(maxRequests));
  res.set('RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
  if (retryAfterMs > 0) {
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
  }
}

function send429(res) {
  return res.status(429).json({
    success: false,
    error: 'rate_limit_exceeded',
    message: 'Too many requests, please try again later',
    code: 'rate_limit_exceeded',
  });
}

/**
 * Per-authenticated-user rate limiter.
 */
function createPerUserRateLimiter(maxRequests, windowMs) {
  return async (req, res, next) => {
    if (!req.user) return err(res, 401, 'Authentication required', 'missing_token');

    const key = `ratelimit:user:${req.user.id}:${req.baseUrl}${req.path}`;
    const { allowed, count, retryAfterMs } = await checkRateLimit(key, maxRequests, windowMs);

    setStandardHeaders(res, maxRequests, count, retryAfterMs);
    if (!allowed) return send429(res);
    return next();
  };
}

/**
 * Per-IP rate limiter.
 */
function createPerIpRateLimiter(maxRequests, windowMs) {
  return async (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `ratelimit:ip:${ip}:${req.baseUrl}${req.path}`;
    const { allowed, count, retryAfterMs } = await checkRateLimit(key, maxRequests, windowMs);

    setStandardHeaders(res, maxRequests, count, retryAfterMs);
    if (!allowed) return send429(res);
    return next();
  };
}

function _reset() {
  memoryStore.clear();
}

module.exports = createPerUserRateLimiter;
module.exports.createPerUserRateLimiter = createPerUserRateLimiter;
module.exports.createPerIpRateLimiter = createPerIpRateLimiter;
module.exports._reset = _reset;
