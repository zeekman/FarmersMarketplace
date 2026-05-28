'use strict';

const cron = require('node-cron');
const logger = require('../logger');
const db = require('../db/schema');
const { sendPayment } = require('../utils/stellar');
const { nextOrderDate } = require('../routes/subscriptions');

const MAX_RETRIES = parseInt(process.env.SUBSCRIPTION_MAX_RETRIES || '3', 10);
const RETRY_DELAY_MINUTES = parseInt(process.env.SUBSCRIPTION_RETRY_DELAY_MINUTES || '60', 10);

/** Errors that should not be retried — transition subscription to 'failed'. */
const PERMANENT_ERROR_CODES = new Set(['account_not_found', 'insufficient_balance']);

function isPermanentError(err) {
  if (PERMANENT_ERROR_CODES.has(err.code)) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('insufficient balance') || msg.includes('account merge');
}

function retryAfterDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + RETRY_DELAY_MINUTES);
  return d.toISOString();
}

/**
 * Idempotency key scoped to subscription + renewal cycle.
 * Using next_order_at ensures a new key per billing period.
 */
function idempotencyKey(sub) {
  return `sub_payment_${sub.id}_${sub.next_order_at}`;
}

/**
 * Lightweight in-process idempotency store (survives within a single run).
 * Durable idempotency is enforced by the order row (status='paid') and
 * the idempotency_keys table via db.query when available.
 */
async function isAlreadyProcessed(sub) {
  // Check for an existing paid order for this subscription cycle
  const key = idempotencyKey(sub);
  try {
    const { rows } = await db.query(
      `SELECT id FROM idempotency_keys WHERE key = $1 AND expires_at > $2`,
      [key, new Date().toISOString()]
    );
    return rows.length > 0;
  } catch {
    // Fallback: check orders table for a paid order in this cycle
    const row = db
      .prepare(
        `SELECT id FROM orders
         WHERE buyer_id = ? AND product_id = ? AND status = 'paid'
           AND created_at >= ?`
      )
      .get(sub.buyer_id, sub.product_id, sub.next_order_at);
    return !!row;
  }
}

async function markProcessed(sub) {
  const key = idempotencyKey(sub);
  const expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25h TTL
  try {
    await db.query(
      `INSERT INTO idempotency_keys (key, response, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify({ success: true }), expiresAt]
    );
  } catch {
    // Non-fatal: idempotency_keys table may not exist in all environments
  }
}

async function processSubscriptions() {
  const now = new Date().toISOString();

  const due = db
    .prepare(
      `SELECT s.*,
              u.stellar_public_key  AS buyer_wallet,
              u.stellar_secret_key  AS buyer_secret,
              p.price,
              p.name                AS product_name,
              fu.stellar_public_key AS farmer_wallet
       FROM subscriptions s
       JOIN users    u  ON s.buyer_id   = u.id
       JOIN products p  ON s.product_id = p.id
       JOIN users    fu ON p.farmer_id  = fu.id
       WHERE s.status = 'active'
         AND s.next_order_at <= ?
         AND (s.retry_after IS NULL OR s.retry_after <= ?)`
    )
    .all(now, now);

  if (due.length === 0) return;
  logger.info(`[subscriptions] Processing ${due.length} due subscription(s)`);

  for (const sub of due) {
    // Guard: re-check status inside loop (another worker may have processed it)
    const current = db
      .prepare('SELECT status, retry_count FROM subscriptions WHERE id = ?')
      .get(sub.id);
    if (!current || current.status !== 'active') {
      logger.info(`[subscriptions] Sub ${sub.id} skipped (status=${current?.status})`);
      continue;
    }

    // Idempotency: skip if already paid this cycle
    if (await isAlreadyProcessed(sub)) {
      logger.info(`[subscriptions] Sub ${sub.id} already processed this cycle, skipping`);
      continue;
    }

    const totalPrice = sub.price * sub.quantity;

    // Atomic stock check + order creation
    let orderId;
    try {
      orderId = db.transaction(() => {
        const deducted = db
          .prepare(
            'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
          )
          .run(sub.quantity, sub.product_id, sub.quantity);
        if (deducted.changes === 0) throw new Error('Insufficient stock');

        const order = db
          .prepare(
            'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?)'
          )
          .run(sub.buyer_id, sub.product_id, sub.quantity, totalPrice, 'pending');
        return order.lastInsertRowid;
      })();
    } catch (e) {
      logger.warn(`[subscriptions] Sub ${sub.id} stock reservation failed: ${e.message}`);
      continue;
    }

    // Attempt Stellar payment
    try {
      const txHash = await sendPayment({
        senderSecret: sub.buyer_secret,
        receiverPublicKey: sub.farmer_wallet,
        amount: totalPrice,
        memo: `Sub#${sub.id}`,
      });

      // Confirm success atomically
      db.transaction(() => {
        db.prepare('UPDATE orders SET status = ?, stellar_tx_hash = ? WHERE id = ?').run(
          'paid',
          txHash,
          orderId
        );
        db.prepare(
          'UPDATE subscriptions SET next_order_at = ?, retry_count = 0, retry_after = NULL WHERE id = ?'
        ).run(nextOrderDate(sub.frequency), sub.id);
      })();

      await markProcessed(sub);

      logger.info(`[subscriptions] Sub ${sub.id} → order ${orderId} paid`, {
        subscriptionId: sub.id,
        orderId,
        txHash: txHash.slice(0, 12),
      });
    } catch (e) {
      // Restore stock
      db.transaction(() => {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
        db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(
          sub.quantity,
          sub.product_id
        );
      })();

      const retryCount = (current.retry_count || 0) + 1;

      if (isPermanentError(e) || retryCount > MAX_RETRIES) {
        db.prepare(
          "UPDATE subscriptions SET status = 'failed', active = 0, retry_count = ? WHERE id = ?"
        ).run(retryCount, sub.id);
        logger.error(`[subscriptions] Sub ${sub.id} permanently failed`, {
          subscriptionId: sub.id,
          reason: isPermanentError(e) ? 'permanent_error' : 'retry_exhausted',
          errorCode: e.code,
          retryCount,
        });
      } else {
        db.prepare(
          'UPDATE subscriptions SET retry_count = ?, retry_after = ? WHERE id = ?'
        ).run(retryCount, retryAfterDate(), sub.id);
        logger.warn(`[subscriptions] Sub ${sub.id} payment failed, scheduled retry ${retryCount}/${MAX_RETRIES}`, {
          subscriptionId: sub.id,
          retryCount,
          errorCode: e.code,
        });
      }
    }
  }
}

function startSubscriptionJob() {
  cron.schedule('0 * * * *', () => {
    processSubscriptions().catch((e) =>
      logger.error('[subscriptions] Job error', { message: e.message })
    );
  });
  logger.info('[subscriptions] Cron job scheduled (hourly)');
}

module.exports = { startSubscriptionJob, processSubscriptions };
