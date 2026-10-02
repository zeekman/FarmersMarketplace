// cache.js — optional Redis caching layer
// Falls through to DB if REDIS_URL is not configured or Redis is unavailable.
// Requires: npm install ioredis
const logger = require('./logger');

let client = null;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    // Keep the client instance on error and let ioredis reconnect automatically.
    // Nulling the client here would permanently disable caching for the life of
    // the process after a single transient error (restart, blip, failover).
    client.on('error', (err) => {
      logCacheError('Redis error', err);
    });
    // lazyConnect: true means we must explicitly connect; ioredis will then
    // apply its built-in reconnect strategy on subsequent failures.
    client.connect().catch((err) => {
      logCacheError('Redis initial connect failed', err);
    });
  } catch {
    logger.debug('[cache] ioredis not available — caching disabled');
  }
}

// Rate-limited warn logging so repeated failures don't spam production logs.
const ERROR_LOG_INTERVAL_MS = 30000;
let lastErrorLogAt = 0;

function logCacheError(message, err) {
  const now = Date.now();
  if (now - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
  lastErrorLogAt = now;
  logger.warn(`[cache] ${message}`, { error: err && err.message });
}

function isReady() {
  return !!client && client.status === 'ready';
}

async function get(key) {
  if (!isReady()) return null;
  try {
    const val = await client.get(key);
    if (val) {
      logger.debug('[cache] HIT', { key });
      return JSON.parse(val);
    }
  } catch (err) {
    logCacheError('get error', err);
  }
  return null;
}

async function set(key, value, ttlSeconds) {
  if (!isReady()) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logCacheError('set error', err);
  }
}

async function del(...keys) {
  if (!isReady()) return;
  try {
    await client.del(...keys);
  } catch (err) {
    logCacheError('del error', err);
  }
}

async function delByPattern(pattern) {
  if (!isReady()) return;
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await client.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logCacheError('delByPattern error', err);
  }
}

// Single helper for product cache invalidation. All product mutations
// (create/PATCH/DELETE, restock, flash sales, images, tiers, order-driven
// stock changes) should route through this so buyers never see stale
// prices/stock for up to a minute.
async function invalidateProducts() {
  await delByPattern('products:*');
}

module.exports = { get, set, del, delByPattern, invalidateProducts };
