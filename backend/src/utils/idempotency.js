const db = require('../db/schema');

/**
 * Checks if an idempotency key exists and returns the cached response if valid.
 * @param {string} key 
 * @returns {object|null}
 */
function getCachedResponse(key) {
  if (!key) return null;
  const row = db.prepare('SELECT response, expires_at FROM idempotency_keys WHERE key = ?').get(key);
  if (row) {
    if (new Date(row.expires_at) > new Date()) {
      try {
        return JSON.parse(row.response);
      } catch (e) {
        console.error(`[Idempotency] Failed to parse cached response for key ${key}:`, e.message);
        return null;
      }
    }
    // Key expired, clean it up
    db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key);
  }
  return null;
}

/**
 * Caches a response for a given idempotency key.
 * @param {string} key 
 * @param {object} response 
 * @param {number} ttlHours 
 */
function cacheResponse(key, response, ttlHours = 24) {
  if (!key) return;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO idempotency_keys (key, response, expires_at) VALUES (?, ?, ?)')
    .run(key, JSON.stringify(response), expiresAt);
}

module.exports = { getCachedResponse, cacheResponse };
