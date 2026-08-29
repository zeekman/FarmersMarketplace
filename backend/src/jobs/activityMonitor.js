/**
 * jobs/activityMonitor.js
 *
 * Background job that polls Stellar Horizon for each user's recent transactions
 * and creates account_alerts when:
 *   - An outgoing payment exceeds 100 XLM
 *   - 3+ failed transactions occur within the last hour
 *
 * Runs every 5 minutes.
 */

const db = require('../db/schema');
const { server } = require('../utils/stellar');
const logger = require('../logger');

const LARGE_PAYMENT_THRESHOLD = 100; // XLM
const FAILED_TX_THRESHOLD = 3;
const FAILED_TX_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_HORIZON_CONCURRENCY = 5;
// Five workers keeps the two Horizon calls per user below a conservative request
// rate while a cycle runs. Increase this only with a longer poll interval or a
// Horizon deployment sized for the expected user count.
const HORIZON_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.ACTIVITY_MONITOR_CONCURRENCY || DEFAULT_HORIZON_CONCURRENCY, 10) ||
    DEFAULT_HORIZON_CONCURRENCY
);

async function checkUser(userId, publicKey) {
  try {
    const payments = await server.payments().forAccount(publicKey).order('desc').limit(50).call();
    const now = Date.now();

    for (const p of payments.records) {
      if (p.type !== 'payment' || p.asset_type !== 'native') continue;
      if (p.from !== publicKey) continue;

      const amount = parseFloat(p.amount);
      if (amount > LARGE_PAYMENT_THRESHOLD) {
        const existing = await db.query(
          `SELECT id FROM account_alerts WHERE user_id = $1 AND type = $2 AND message LIKE $3`,
          [userId, 'large_payment', `%${p.transaction_hash}%`]
        );
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO account_alerts (user_id, type, message) VALUES ($1, $2, $3)`,
            [
              userId,
              'large_payment',
              `Large outgoing payment of ${amount.toFixed(2)} XLM detected (tx: ${p.transaction_hash})`,
            ]
          );
        }
      }
    }

    const cutoff = new Date(now - FAILED_TX_WINDOW_MS).toISOString();
    const txPage = await server.transactions().forAccount(publicKey).order('desc').limit(50).call();
    const recentFailed = txPage.records.filter(
      (tx) => !tx.successful && new Date(tx.created_at) >= new Date(cutoff)
    );

    if (recentFailed.length >= FAILED_TX_THRESHOLD) {
      const existing = await db.query(
        `SELECT id FROM account_alerts WHERE user_id = $1 AND type = $2 AND created_at >= $3`,
        [userId, 'failed_transactions', cutoff]
      );
      if (existing.rows.length === 0) {
        await db.query(`INSERT INTO account_alerts (user_id, type, message) VALUES ($1, $2, $3)`, [
          userId,
          'failed_transactions',
          `${recentFailed.length} failed transactions detected in the last hour.`,
        ]);
      }
    }
  } catch (err) {
    const status = err?.status || err?.response?.status;
    if (status === 429) {
      logger.warn('[activityMonitor] Horizon rate limit reached', {
        userId,
        publicKey,
        retryAfter: err?.response?.headers?.['retry-after'],
      });
    } else if (status !== 404) {
      logger.warn('[activityMonitor] Horizon account poll failed', {
        userId,
        publicKey,
        status,
        error: err?.message,
      });
    }
    // Account-not-found responses are expected for stale wallet records.
  }
}

async function runWithConcurrency(items, worker, concurrency) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]);
      }
    })
  );
}

async function runActivityMonitor() {
  try {
    const { rows } = await db.query(
      `SELECT id, stellar_public_key FROM users WHERE stellar_public_key IS NOT NULL AND active = 1`
    );
    await runWithConcurrency(
      rows,
      (user) => checkUser(user.id, user.stellar_public_key),
      HORIZON_CONCURRENCY
    );
  } catch (e) {
    logger.error('[activityMonitor] Error', { error: e.message });
  }
}

function startActivityMonitor() {
  runActivityMonitor();
  return setInterval(runActivityMonitor, POLL_INTERVAL_MS);
}

module.exports = {
  startActivityMonitor,
  runActivityMonitor,
  checkUser,
  runWithConcurrency,
  HORIZON_CONCURRENCY,
};
