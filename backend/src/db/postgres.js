const { Pool } = require('pg');
const logger = require('../logger');

const statementTimeout = parseInt(process.env.DB_QUERY_TIMEOUT_POSTGRES || '10000', 10);
const poolMax = parseInt(process.env.PG_POOL_MAX || '10', 10);
const idleTimeoutMs = parseInt(process.env.PG_IDLE_TIMEOUT_MS || '10000', 10);
const connectionTimeoutMs = parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '5000', 10);
const slowQueryMs = parseInt(process.env.SLOW_QUERY_MS || '500', 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: idleTimeoutMs,
  connectionTimeoutMillis: connectionTimeoutMs,
  statement_timeout: statementTimeout,
});

// Log slow queries with a normalized SQL fingerprint (no parameter values) and requestId
const originalQuery = pool.query.bind(pool);
pool.query = async function (text, params) {
  const start = Date.now();
  try {
    const result = await originalQuery(text, params);
    const duration = Date.now() - start;
    
    if (duration >= slowQueryMs) {
      // Normalize SQL: replace parameter placeholders with ? to get a fingerprint
      const fingerprint = text.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').trim();
      logger.warn('[SlowQuery]', {
        duration,
        fingerprint,
        // requestId is attached by the request context middleware when available
        requestId: global.requestId,
      });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('[QueryError]', {
      duration,
      error: error.message,
      requestId: global.requestId,
    });
    throw error;
  }
};

// Expose pool stats for health checks
pool.getStats = function () {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: poolMax,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    statementTimeout,
  };
};

module.exports = pool;

