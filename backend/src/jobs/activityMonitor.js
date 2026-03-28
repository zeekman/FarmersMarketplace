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

const LARGE_PAYMENT_THRESHOLD = 100; // XLM
const FAILED_TX_THRESHOLD = 3;
const FAILED_TX_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function checkUser(userId, publicKey) {
  try {
    // Fetch recent payments
    const payments = await server
      .payments()
      .forAccount(publicKey)
      .order('desc')
      .limit(50)
      .call();

    const now = Date.now();

    for (const p of payments.records) {
      if (p.type !== 'payment' || p.asset_type !== 'native') continue;
      if (p.from !== publicKey) continue; // only outgoing

      const amount = parseFloat(p.amount);
      if (amount > LARGE_PAYMENT_THRESHOLD) {
        // Avoid duplicate alerts for the same transaction
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

    // Check for failed transactions in the last hour
    const cutoff = new Date(now - FAILED_TX_WINDOW_MS).toISOString();
    const txPage = await server
      .transactions()
      .forAccount(publicKey)
      .order('desc')
      .limit(50)
      .call();

    const recentFailed = txPage.records.filter(
      (tx) => !tx.successful && new Date(tx.created_at) >= new Date(cutoff)
    );

    if (recentFailed.length >= FAILED_TX_THRESHOLD) {
      // Only alert once per hour window — check if we already have a recent alert
      const existing = await db.query(
        `SELECT id FROM account_alerts WHERE user_id = $1 AND type = $2 AND created_at >= $3`,
        [userId, 'failed_transactions', cutoff]
      );
      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO account_alerts (user_id, type, message) VALUES ($1, $2, $3)`,
          [
            userId,
            'failed_transactions',
            `${recentFailed.length} failed transactions detected in the last hour.`,
          ]
        );
      }
    }
  } catch {
    // Silently skip users whose accounts aren't funded / not found on Horizon
  }
}

async function runActivityMonitor() {
  try {
    const { rows } = await db.query(
      `SELECT id, stellar_public_key FROM users WHERE stellar_public_key IS NOT NULL AND active = 1`
    );
    await Promise.allSettled(rows.map((u) => checkUser(u.id, u.stellar_public_key)));
  } catch (e) {
    console.error('[activityMonitor] Error:', e.message);
  }
}

function startActivityMonitor() {
  // Run once at startup, then on interval
  runActivityMonitor();
  return setInterval(runActivityMonitor, POLL_INTERVAL_MS);
}

module.exports = { startActivityMonitor, runActivityMonitor };
