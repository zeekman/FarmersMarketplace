const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_POSTGRES || '10000', 10),
});

module.exports = pool;
