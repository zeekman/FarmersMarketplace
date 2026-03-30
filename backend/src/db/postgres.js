const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : false,
});

pool.on('error', (err) => {
  console.error('[PG] Unexpected pool error:', err.message);
});

/**
 * Run a query. Returns { rows, rowCount }.
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Get a client for transactions.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
