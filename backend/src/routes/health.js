const router = require('express').Router();
const db = require('../db/schema');
const logger = require('../logger');
const { checkSorobanRPC } = require('../utils/stellar');
const { server: horizonServer } = require('../utils/stellar-config');
const { jobsEnabled } = require('../jobs');
const packageJson = require('../../package.json');

const TIMEOUT_MS = 2000; // 2s timeout as per Acceptance Criteria

/**
 * Wraps a promise with a timeout.
 */
function withTimeout(promise, ms, name = 'Operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Verifies database responsiveness via SELECT 1.
 */
async function checkDb(timeoutMs = TIMEOUT_MS) {
  const startTime = Date.now();
  try {
    await withTimeout(db.query('SELECT 1'), timeoutMs, 'Database query');
    const responseTime = Date.now() - startTime;
    return { status: 'healthy', responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Database health check failed:', { error: error.message });
    return { status: 'unhealthy', error: error.message, responseTime };
  }
}

/**
 * Verifies that database migrations (db.ready) have completed.
 */
async function checkDbReady(timeoutMs = TIMEOUT_MS) {
  if (!db.ready) return true;
  await withTimeout(Promise.resolve(db.ready), timeoutMs, 'db.ready');
  return true;
}

/**
 * Checks Redis health: reports disabled | healthy | unhealthy.
 */
async function checkRedis(timeoutMs = TIMEOUT_MS) {
  const startTime = Date.now();
  if (!process.env.REDIS_URL) {
    return { status: 'disabled', message: 'REDIS_URL not configured' };
  }

  let Redis;
  try {
    Redis = require('ioredis');
  } catch {
    return { status: 'disabled', message: 'ioredis not installed' };
  }

  let client = null;
  try {
    client = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: timeoutMs,
      maxRetriesPerRequest: 0,
    });
    await withTimeout(client.ping(), timeoutMs, 'Redis ping');
    const responseTime = Date.now() - startTime;
    return { status: 'healthy', responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Redis health check failed:', { error: error.message });
    return { status: 'unhealthy', error: error.message, responseTime };
  } finally {
    if (client) {
      try {
        await client.quit();
      } catch {
        try {
          client.disconnect();
        } catch (_) {}
      }
    }
  }
}

/**
 * Checks Horizon server and determines latest ledger age.
 */
async function checkHorizon(timeoutMs = TIMEOUT_MS) {
  const startTime = Date.now();
  try {
    if (!horizonServer) {
      return { status: 'unhealthy', error: 'Horizon server not configured', responseTime: 0, latestLedgerAge: null };
    }

    let root = null;
    if (typeof horizonServer.root === 'function') {
      root = await withTimeout(horizonServer.root(), timeoutMs, 'Horizon root');
    }

    let latestLedgerAge = null;
    let latestLedger = null;

    if (root) {
      latestLedger = root.history_latest_ledger || root.core_latest_ledger || null;
      if (root.latestLedgerAge != null) {
        latestLedgerAge = root.latestLedgerAge;
      } else {
        const closedAtStr = root.history_latest_ledger_closed_at || root.core_latest_ledger_closed_at;
        if (closedAtStr) {
          const closedAt = new Date(closedAtStr).getTime();
          if (!isNaN(closedAt)) {
            latestLedgerAge = Math.max(0, Math.floor((Date.now() - closedAt) / 1000));
          }
        }
      }
    }

    // Fallback: if root did not provide closed_at or ledger age, try ledgers() call if available
    if (latestLedgerAge == null && typeof horizonServer.ledgers === 'function') {
      try {
        const ledgerPage = await withTimeout(
          horizonServer.ledgers().order('desc').limit(1).call(),
          timeoutMs,
          'Horizon ledgers'
        );
        if (ledgerPage?.records?.[0]) {
          latestLedger = ledgerPage.records[0].sequence;
          const closedAtStr = ledgerPage.records[0].closed_at;
          if (closedAtStr) {
            const closedAt = new Date(closedAtStr).getTime();
            if (!isNaN(closedAt)) {
              latestLedgerAge = Math.max(0, Math.floor((Date.now() - closedAt) / 1000));
            }
          }
        }
      } catch (_) {
        // If ledgers() call fails, keep root result
      }
    }

    const responseTime = Date.now() - startTime;
    return {
      status: 'healthy',
      responseTime,
      latestLedgerAge,
      latestLedger,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Horizon health check failed:', { error: error.message });
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime,
      latestLedgerAge: null,
    };
  }
}

/**
 * Checks Soroban RPC health.
 */
async function checkSoroban(timeoutMs = TIMEOUT_MS) {
  const startTime = Date.now();
  try {
    const result = await withTimeout(checkSorobanRPC(), timeoutMs, 'Soroban RPC');
    return result;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      status: 'unhealthy',
      responseTime,
      error: error.message || 'Unknown error',
      details: {
        code: error.code,
        type: error.constructor ? error.constructor.name : 'Error',
      },
    };
  }
}

/**
 * Checks whether this process is the jobs leader.
 */
function isJobsLeader() {
  if (typeof jobsEnabled === 'function') {
    return Boolean(jobsEnabled());
  }
  return process.env.RUN_JOBS === 'true';
}

// -----------------------------------------------------------------------------
// Endpoints
// -----------------------------------------------------------------------------

// 1. Basic liveness check: dependency-free
router.get(['/health', '/health/liveness'], (_, res) => {
  res.json({ status: 'ok' });
});

// 2. Readiness check: verifies DB SELECT 1 and db.ready migrations
router.get(['/health/ready', '/ready', '/api/health/ready', '/api/v1/health/ready'], async (req, res) => {
  const startTime = Date.now();
  try {
    await Promise.all([
      checkDbReady(TIMEOUT_MS),
      withTimeout(db.query('SELECT 1'), TIMEOUT_MS, 'Database query'),
    ]);

    return res.status(200).json({
      status: 'ok',
      ready: true,
      db: 'healthy',
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    logger.warn('Readiness check failed:', { error: error.message });
    return res.status(503).json({
      status: 'error',
      ready: false,
      error: error.message,
      db: 'unhealthy',
      responseTime: Date.now() - startTime,
    });
  }
});

// 3. Comprehensive detailed health check with dependencies
router.get(
  ['/health/detailed', '/detailed', '/api/health/detailed', '/api/v1/health/detailed'],
  async (req, res) => {
    const startTime = Date.now();

    try {
      const [dbHealth, redisHealth, horizonHealth, sorobanHealth] = await Promise.all([
        checkDb(TIMEOUT_MS),
        checkRedis(TIMEOUT_MS),
        checkHorizon(TIMEOUT_MS),
        checkSoroban(TIMEOUT_MS),
      ]);

      // Get PostgreSQL pool stats if available
      let poolStats = null;
      if (db.isPostgres && typeof db.getStats === 'function') {
        try {
          poolStats = db.getStats();
        } catch (e) {
          logger.warn('Failed to get pool stats:', { error: e.message });
        }
      }

      const overallResponseTime = Date.now() - startTime;
      const isDbHealthy = dbHealth.status === 'healthy';
      const isRedisOk = redisHealth.status !== 'unhealthy';
      const isHorizonHealthy = horizonHealth.status === 'healthy';
      const isSorobanHealthy = sorobanHealth.status === 'healthy';

      const isHealthy = isDbHealthy && isRedisOk && isHorizonHealthy && isSorobanHealthy;
      const appVersion = packageJson.version || '1.0.0';
      const jobsLeader = isJobsLeader();

      const services = {
        db: dbHealth,
        redis: redisHealth,
        horizon: horizonHealth,
        soroban: sorobanHealth,
      };

      const response = {
        status: isHealthy ? 'ok' : 'degraded',
        responseTime: overallResponseTime,
        timestamp: new Date().toISOString(),
        version: appVersion,
        jobsLeader,
        services,
        db: dbHealth,
        redis: redisHealth,
        horizon: horizonHealth,
        soroban: sorobanHealth,
        ...(poolStats && { poolStats }),
      };

      const statusCode = isHealthy ? 200 : 503;
      res.status(statusCode).json(response);
    } catch (error) {
      const overallResponseTime = Date.now() - startTime;
      const appVersion = packageJson.version || '1.0.0';
      const jobsLeader = isJobsLeader();

      res.status(503).json({
        status: 'error',
        responseTime: overallResponseTime,
        timestamp: new Date().toISOString(),
        version: appVersion,
        jobsLeader,
        error: error.message,
        services: {
          db: { status: 'unhealthy', error: error.message },
          redis: { status: 'unhealthy', error: error.message },
          horizon: { status: 'unhealthy', error: error.message },
          soroban: { status: 'unhealthy', error: error.message },
        },
      });
    }
  }
);

router.withTimeout = withTimeout;
router.checkDb = checkDb;
router.checkDbReady = checkDbReady;
router.checkRedis = checkRedis;
router.checkHorizon = checkHorizon;
router.checkSoroban = checkSoroban;
router.isJobsLeader = isJobsLeader;
router.TIMEOUT_MS = TIMEOUT_MS;

module.exports = router;
