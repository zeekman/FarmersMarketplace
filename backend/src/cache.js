// cache.js — optional Redis caching layer
// Falls through to DB if REDIS_URL is not configured or Redis is unavailable.
// Requires: npm install ioredis
const logger = require('./logger');

let client = null;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    client.on('error', (err) => {
      logger.debug('[cache] Redis error (cache disabled)', { error: err.message });
      client = null;
    });
  } catch {
    logger.debug('[cache] ioredis not available — caching disabled');
  }
}

async function get(key) {
  if (!client) return null;
  try {
    const val = await client.get(key);
    if (val) {
      logger.debug('[cache] HIT', { key });
      return JSON.parse(val);
    }
  } catch (err) {
    logger.debug('[cache] get error', { error: err.message });
  }
  return null;
}

async function set(key, value, ttlSeconds) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.debug('[cache] set error', { error: err.message });
  }
}

async function del(...keys) {
  if (!client) return;
  try {
    await client.del(...keys);
  } catch (err) {
    logger.debug('[cache] del error', { error: err.message });
  }
}

async function delByPattern(pattern) {
  if (!client) return;
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await client.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logger.debug('[cache] delByPattern error', { error: err.message });
  }
}

module.exports = { get, set, del, delByPattern };
