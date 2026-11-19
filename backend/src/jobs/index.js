'use strict';

/**
 * Single place where background jobs are registered and started (#1367).
 *
 * startJobs() is called only from src/index.js, and only schedules anything when
 * RUN_JOBS=true. Run exactly one process with RUN_JOBS=true per deployment (the
 * "jobs leader"); every other instance serves HTTP only, so subscriptions,
 * auction settlement, emails and backups don't run N times. Importing app.js
 * (tests, scripts) no longer starts any timers.
 *
 * Every job runs through runExclusive(): a tick that fires while the previous
 * run is still going is skipped (no overlap), and each run logs structured
 * start / finish / duration / error lines.
 *
 * Job modules are required lazily so that loading this file has no side effects.
 */

const cron = require('node-cron');
const crypto = require('crypto');
const logger = require('../logger');
const config = require('../config');
const cache = require('../cache');

const MINUTE = 60 * 1000;
const JOB_LOCK_TTL_MS = parseInt(process.env.JOB_LOCK_TTL_MS || String(10 * MINUTE), 10);

/**
 * Registry. Each job has either `cron` (UTC cron expression) or `intervalMs`,
 * optional `runOnStart`, and optional `enabled()` for jobs that depend on config.
 */
const JOBS = [
  {
    name: 'subscriptions',
    cron: '0 * * * *', // hourly
    run: () => require('./processSubscriptions').processSubscriptions(),
  },
  {
    name: 'daily-backup',
    cron: '0 0 * * *', // 00:00 UTC
    run: () => require('../../scripts/backup').createBackup(),
  },
  {
    name: 'product-views-aggregation',
    cron: '0 1 * * *', // 01:00 UTC, after the backup
    run: () => require('./aggregateProductViews').aggregateProductViews(),
  },
  {
    name: 'failed-email-cleanup',
    cron: '0 2 * * *',
    run: () =>
      require('./cleanupFailedEmails').cleanupFailedEmails(
        parseInt(process.env.FAILED_EMAIL_RETENTION_DAYS || '7', 10)
      ),
  },
  {
    name: 'push-subscription-cleanup',
    cron: '0 2 * * *',
    run: () => require('./cleanupPushSubscriptions').cleanupExpiredPushSubscriptions(),
  },
  {
    name: 'idempotency-key-purge',
    cron: '30 * * * *', // hourly
    run: () => require('./purgeIdempotencyKeys').purgeIdempotencyKeys(),
  },
  {
    name: 'product-expiry-scheduling',
    cron: '0 2 * * *',
    run: () => require('./deactivateExpiredProducts').runSchedulingJob(),
  },
  {
    name: 'anonymize-deactivated-users',
    cron: '0 3 * * *',
    run: () => require('./anonymizeDeactivatedUsers').anonymizeDeactivatedUsers(),
  },
  {
    name: 'orphaned-uploads-cleanup',
    cron: process.env.ORPHAN_CLEANUP_CRON || '0 3 * * *',
    run: () =>
      require('./reconcileOrphanedUploads').reconcileOrphanedUploads({
        dryRun: false,
        gracePeriodSeconds: parseInt(process.env.UPLOAD_ORPHAN_GRACE_SECONDS || '3600', 10),
      }),
  },
  {
    name: 'freshness-alerts',
    cron: '0 9 * * *',
    run: () => require('./processFreshnessAlerts').runFreshnessAlerts(),
  },
  {
    name: 'auction-settlement',
    intervalMs: MINUTE,
    runOnStart: true,
    run: () => require('./auctionCron').closeExpiredAuctions(),
  },
  {
    // Previously never started (#1352): 'confirming' orders stayed there forever.
    name: 'confirm-payments',
    intervalMs: parseInt(process.env.CONFIRM_PAYMENTS_INTERVAL_MS || '15000', 10),
    run: () => require('./confirmPayments').confirmPendingOrders(),
  },
  {
    name: 'activity-monitor',
    intervalMs: 5 * MINUTE,
    runOnStart: true,
    run: () => require('./activityMonitor').runActivityMonitor(),
  },
  {
    name: 'contract-monitor',
    intervalMs: 5 * MINUTE,
    runOnStart: true,
    run: () => require('./contractMonitor').runMonitoringJob(),
  },
  {
    name: 'escrow-reconciliation',
    intervalMs: parseInt(process.env.ESCROW_RECONCILE_INTERVAL_MS || String(15 * MINUTE), 10),
    runOnStart: true,
    enabled: () => !!config.sorobanEscrowContractId,
    run: () => require('./reconcileEscrow').reconcileEscrow(),
  },
  {
    name: 'timeout-escrow-refunds',
    cron: '0 * * * *', // hourly UTC; RUN_JOBS + runExclusive provide leader-only execution
    enabled: () => !!(config.sorobanEscrowContractId && config.platformFeeAccountSecret),
    run: () => require('./timeoutRefunds').runTimeoutRefunds(),
  },
  {
    name: 'contract-registry-sync',
    intervalMs: parseInt(process.env.REGISTRY_SYNC_INTERVAL_MS || '300000', 10),
    runOnStart: true,
    run: () => require('./contractRegistrySync').runSync(),
  },
  {
    name: 'creator-earnings-monitor',
    intervalMs: 5 * MINUTE,
    runOnStart: true,
    enabled: () => !!config.sorobanCreatorEarningsContractId,
    run: () => require('./creatorEarningsMonitor').runMonitoringJob(),
  },
];

const running = new Set();

/**
 * Runs a job unless its previous run is still in progress, with structured logs.
 * Never throws: failures are logged so a bad run can't crash the scheduler.
 * @returns {Promise<'completed'|'failed'|'skipped'>}
 */
async function runExclusive(name, run) {
  if (running.has(name)) {
    logger.warn('[jobs] Skipping run: previous run still in progress', { job: name, event: 'job_skipped' });
    return 'skipped';
  }
  running.add(name);
  const lockKey = `jobs:lock:${name}`;
  const lockOwner = crypto.randomUUID();
  let distributedLock = null;
  const startedAt = Date.now();
  try {
    if (typeof cache.acquireLock === 'function') {
      distributedLock = await cache.acquireLock(lockKey, lockOwner, JOB_LOCK_TTL_MS);
      if (distributedLock === false) {
        logger.info('[jobs] Skipping run: another instance holds the lock', { job: name, event: 'job_skipped_locked' });
        return 'skipped';
      }
      if (distributedLock === null) {
        logger.warn('[jobs] Distributed lock unavailable; using process-local guard', { job: name, event: 'job_lock_unavailable' });
      }
    }
    logger.info('[jobs] Job started', { job: name, event: 'job_started' });
    await run();
    logger.info('[jobs] Job finished', { job: name, event: 'job_finished', durationMs: Date.now() - startedAt });
    return 'completed';
  } catch (error) {
    logger.error('[jobs] Job failed', {
      job: name,
      event: 'job_failed',
      durationMs: Date.now() - startedAt,
      error: error.message,
    });
    return 'failed';
  } finally {
    if (distributedLock === true && typeof cache.releaseLock === 'function') {
      await cache.releaseLock(lockKey, lockOwner);
    }
    running.delete(name);
  }
}

function jobsEnabled(env = process.env) {
  return env.RUN_JOBS === 'true';
}

/**
 * Schedules every registered job. No-op unless RUN_JOBS=true.
 * @returns {() => void} stopJobs — clears every timer/cron task it created.
 */
function startJobs({ env = process.env, jobs = JOBS } = {}) {
  if (!jobsEnabled(env)) {
    logger.info('[jobs] RUN_JOBS is not "true" — background jobs disabled in this process');
    return () => {};
  }

  const stops = [];
  for (const job of jobs) {
    if (job.enabled && !job.enabled()) {
      logger.info('[jobs] Job disabled by configuration', { job: job.name });
      continue;
    }
    const tick = () => runExclusive(job.name, job.run);

    if (job.cron) {
      const task = cron.schedule(job.cron, tick, { scheduled: true, timezone: 'UTC' });
      stops.push(() => task.stop());
      logger.info('[jobs] Job scheduled', { job: job.name, cron: job.cron, timezone: 'UTC' });
    } else {
      const handle = setInterval(tick, job.intervalMs);
      stops.push(() => clearInterval(handle));
      logger.info('[jobs] Job scheduled', { job: job.name, intervalMs: job.intervalMs });
    }
    if (job.runOnStart) tick();
  }

  return function stopJobs() {
    stops.forEach((stop) => stop());
  };
}

module.exports = { JOBS, startJobs, runExclusive, jobsEnabled };
