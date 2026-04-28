// cache.js — optional Redis caching layer
// Falls through to DB if REDIS_URL is not configured or Redis is unavailable.
// Requires: npm install ioredis

let client = null;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    client.on('error', (err) => {
      console.debug('[cache] Redis error (cache disabled):', err.message);
      client = null;
    });
  } catch {
    console.debug('[cache] ioredis not available — caching disabled');
  }
}

async function get(key) {
  if (!client) return null;
  try {
    const val = await client.get(key);
    if (val) {
      console.debug('[cache] HIT', key);
      return JSON.parse(val);
    }
  } catch (err) {
    console.debug('[cache] get error:', err.message);
  }
  return null;
}

async function set(key, value, ttlSeconds) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.debug('[cache] set error:', err.message);
  }
}

async function del(...keys) {
  if (!client) return;
  try {
    await client.del(...keys);
  } catch (err) {
    console.debug('[cache] del error:', err.message);
  }
}

module.exports = { get, set, del };
