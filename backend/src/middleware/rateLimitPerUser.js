/**
 * rateLimitPerUser.js
 *
 * Sliding-window rate limiters for per-user and per-IP enforcement.
 *
 * REDIS (when REDIS_URL is configured):
 *   Uses a Redis sorted-set per key. A Lua script removes expired members,
 *   checks the count atomically, and adds the current request if allowed.
 *   This makes the implementation safe under concurrent distributed traffic.
 *
 * IN-MEMORY FALLBACK (local dev / no Redis):
 *   A module-level Map stores timestamps per key. Old timestamps are pruned
 *   on every check. Accurate for single-process deployments and tests.
 *
 * RESPONSE ON VIOLATION:
 *   HTTP 429 with { code: 'rate_limit_exceeded' }
 *   Headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After
 */

const { err } = require('./error');

// In-memory sliding-window store: key -> number[] (sorted timestamps)
const memoryStore = new Map();

let redisClient = null;
let redisInitialized = false;

function getRedisClient() {
  if (redisInitialized) return redisClient;
  redisInitialized = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.on('error', (e) => {
      console.debug('[ratelimit] Redis error, falling back to memory:', e.message);
      redisClient = null;
    });
  } catch {
    console.debug('[ratelimit] ioredis not available, using in-memory store');
  }
  return redisClient;
}

// Atomic Lua script: clean expired members → count → reject or add + expire.
// Returns -1 when the request is rejected, otherwise returns the new count.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
local count = tonumber(redis.call('ZCARD', key))
if count >= max then
  return -1
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return count + 1
`;

async function redisSlide(client, key, maxRequests, windowMs) {
  const now = Date.now();
  const windowStart = now - windowMs;
  const ttlSeconds = Math.ceil(windowMs / 1000);
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  const result = await client.eval(
    SLIDING_WINDOW_LUA, 1, key,
    String(now), String(windowStart), String(maxRequests), String(ttlSeconds), member,
  );

  const count = Number(result);
  if (count === -1) return { allowed: false, count: maxRequests };
  return { allowed: true, count };
}

function memorySlide(key, maxRequests, windowMs) {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Prune expired timestamps on every check
  const timestamps = (memoryStore.get(key) || []).filter((t) => t > windowStart);

  if (timestamps.length >= maxRequests) {
    memoryStore.set(key, timestamps);
    return { allowed: false, count: timestamps.length };
  }

  timestamps.push(now);
  memoryStore.set(key, timestamps);
  return { allowed: true, count: timestamps.length };
}

async function slidingWindowCheck(key, maxRequests, windowMs) {
  const client = getRedisClient();
  if (client) {
    try {
      return await redisSlide(client, key, maxRequests, windowMs);
    } catch (e) {
      console.debug('[ratelimit] Redis eval failed, falling back to memory:', e.message);
    }
  }
  return memorySlide(key, maxRequests, windowMs);
}

function setStandardHeaders(res, maxRequests, count) {
  res.set('X-RateLimit-Limit', String(maxRequests));
  res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
}

function send429(res, windowMs) {
  const retryAfter = Math.ceil(windowMs / 1000);
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({
    success: false,
    error: 'rate_limit_exceeded',
    message: 'Too many requests, please try again later',
    code: 'rate_limit_exceeded',
  });
}

/**
 * Per-authenticated-user sliding-window rate limiter.
 * Requires auth middleware to have populated req.user before this runs.
 *
 * @param {number} maxRequests - Requests allowed per window
 * @param {number} windowMs   - Window length in milliseconds
 */
function createPerUserRateLimiter(maxRequests, windowMs) {
  return async (req, res, next) => {
    if (!req.user) return err(res, 401, 'Authentication required', 'missing_token');

    const key = `ratelimit:user:${req.user.id}:${req.baseUrl}${req.path}`;
    const { allowed, count } = await slidingWindowCheck(key, maxRequests, windowMs);

    setStandardHeaders(res, maxRequests, count);
    if (!allowed) return send429(res, windowMs);
    return next();
  };
}

/**
 * Per-IP sliding-window rate limiter.
 * For unauthenticated endpoints such as login and register.
 *
 * @param {number} maxRequests - Requests allowed per window
 * @param {number} windowMs   - Window length in milliseconds
 */
function createPerIpRateLimiter(maxRequests, windowMs) {
  return async (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `ratelimit:ip:${ip}:${req.baseUrl}${req.path}`;
    const { allowed, count } = await slidingWindowCheck(key, maxRequests, windowMs);

    setStandardHeaders(res, maxRequests, count);
    if (!allowed) return send429(res, windowMs);
    return next();
  };
}

/** Clear the in-memory store and reset the Redis client — for use in tests only. */
function _reset() {
  memoryStore.clear();
  redisClient = null;
  redisInitialized = false;
}

module.exports = createPerUserRateLimiter;
module.exports.createPerUserRateLimiter = createPerUserRateLimiter;
module.exports.createPerIpRateLimiter = createPerIpRateLimiter;
module.exports._reset = _reset;
