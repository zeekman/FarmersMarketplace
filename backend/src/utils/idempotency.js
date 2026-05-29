const db = require('../db/schema');

async function getCachedResponse(key) {
  if (!key) return null;
  const { rows } = await db.query(
    'SELECT response, expires_at FROM idempotency_keys WHERE key = $1',
    [key]
  );
  const row = rows[0];
  if (row) {
    if (new Date(row.expires_at) > new Date()) {
      try {
        return JSON.parse(row.response);
      } catch {
        return null;
      }
    }
    await db.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
  }
  return null;
}

async function cacheResponse(key, response, ttlHours = 24) {
  if (!key) return;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await db.query(
    'INSERT INTO idempotency_keys (key, response, expires_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at',
    [key, JSON.stringify(response), expiresAt]
  );
}

module.exports = { getCachedResponse, cacheResponse };
