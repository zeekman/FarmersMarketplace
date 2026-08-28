'use strict';

const cron = require('node-cron');
const logger = require('../logger');
const db = require('../db/schema');
const { sendPayment } = require('../utils/stellar');
const { nextOrderDate } = require('../routes/subscriptions');
const mailer = require('../utils/mailer');

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
  } catch (error) {
    logger.warn('[subscriptions] Idempotency table check failed; using order fallback', {
      error: error.message,
    });
    // Fallback: check orders table for a paid order in this cycle
    const { rows } = await db.query(
      `SELECT id FROM orders
           WHERE buyer_id = $1 AND product_id = $2 AND status = 'paid'
           AND created_at >= $3`,
      [sub.buyer_id, sub.product_id, sub.next_order_at]
    );
    return rows.length > 0;
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
  } catch (error) {
    // Non-fatal: idempotency_keys table may not exist in all environments
    logger.warn('[subscriptions] Could not persist idempotency key', { error: error.message });
  }
}

async function processSubscriptions() {
  const now = new Date().toISOString();

  const { rows: due } = await db.query(
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
         AND s.next_order_at <= $1
            AND (s.retry_after IS NULL OR s.retry_after <= $2)`,
          [now, now]
        );

  if (due.length === 0) return;
  logger.info(`[subscriptions] Processing ${due.length} due subscription(s)`);

  for (const sub of due) {
    // Guard: re-check status inside loop (another worker may have processed it)
    const { rows: currentRows } = await db.query(
      'SELECT status, retry_count FROM subscriptions WHERE id = $1',
      [sub.id]
    );
    const current = currentRows[0];
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
      const { rows: deducted } = await db.query(
        'UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1 RETURNING id',
        [sub.quantity, sub.product_id]
      );
      if (deducted.length === 0) throw new Error('Insufficient stock');
      const { rows: orders } = await db.query(
        'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [sub.buyer_id, sub.product_id, sub.quantity, totalPrice, 'pending']
      );
      orderId = orders[0].id;
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
      await db.query(
        'UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3',
        ['paid', txHash, orderId]
      );
      await db.query(
        'UPDATE subscriptions SET next_order_at = $1, retry_count = 0, retry_after = NULL WHERE id = $2',
        [nextOrderDate(sub.frequency), sub.id]
      );

      await markProcessed(sub);

      logger.info(`[subscriptions] Sub ${sub.id} → order ${orderId} paid`, {
        subscriptionId: sub.id,
        orderId,
        txHash: txHash.slice(0, 12),
      });
    } catch (e) {
      // Restore stock
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
      await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [
        sub.quantity,
        sub.product_id,
      ]);

      const retryCount = (current.retry_count || 0) + 1;

      if (isPermanentError(e) || retryCount > MAX_RETRIES) {
<<<<<<< HEAD
        db.prepare(
          "UPDATE subscriptions SET status = 'payment_failed', active = 0, retry_count = ? WHERE id = ?"
        ).run(retryCount, sub.id);

        // Notify buyer that subscription payment has permanently failed
        try {
          const buyerRow = db.prepare('SELECT email, name FROM users WHERE id = ?').get(sub.buyer_id);
          if (buyerRow) {
            await mailer.sendSubscriptionPaymentFailedEmail({
              buyer: buyerRow,
              subscription: sub,
            });
          }
        } catch (mailErr) {
          logger.warn('[subscriptions] Failed to send payment_failed email', { subscriptionId: sub.id });
        }

=======
        await db.query(
          "UPDATE subscriptions SET status = 'failed', active = 0, retry_count = $1 WHERE id = $2",
          [retryCount, sub.id]
        );
>>>>>>> 58a75df (feat: improve email verification and password reset)
        logger.error(`[subscriptions] Sub ${sub.id} permanently failed`, {
          subscriptionId: sub.id,
          reason: isPermanentError(e) ? 'permanent_error' : 'retry_exhausted',
          errorCode: e.code,
          retryCount,
        });
      } else {
        await db.query(
          'UPDATE subscriptions SET retry_count = $1, retry_after = $2 WHERE id = $3',
          [retryCount, retryAfterDate(), sub.id]
        );
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
