'use strict';

const cron = require('node-cron');
const db = require('../db/schema');
const logger = require('../logger');
const { sendProductExpiredEmail } = require('../utils/mailer');

const BATCH_SIZE = parseInt(process.env.EXPIRY_BATCH_SIZE || '100', 10);

/**
 * Returns the UTC date string (YYYY-MM-DD) for the given Date, defaulting to today.
 * Accepting an explicit date makes the function testable without time-travel.
 */
function todayUTC(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Deactivate all active products whose best_before < today (UTC) and send
 * one expiry notification email per product to the owning farmer.
 *
 * Idempotency: the UPDATE only touches rows where active=1 AND expiry_notified_at IS NULL,
 * so reruns are safe — already-processed products are skipped automatically.
 *
 * Batching: fetches products in pages of BATCH_SIZE to keep memory bounded.
 *
 * @param {string} [date] - ISO date string YYYY-MM-DD; defaults to today UTC.
 * @returns {Promise<{date: string, deactivated: number, notified: number, skipped: number}>}
 */
async function deactivateExpiredProducts(date) {
  const cutoff = date || todayUTC();
  logger.info('[expiry-job] Starting expired product deactivation', { cutoff });

  let deactivated = 0;
  let notified = 0;
  let skipped = 0;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await fetchExpiredBatch(cutoff, offset, BATCH_SIZE);
    if (batch.length === 0) break;

    for (const product of batch) {
      try {
        await processProduct(product, cutoff);
        deactivated++;
        if (product.farmer_email) {
          notified++;
        } else {
          logger.warn('[expiry-job] Farmer email missing, skipping notification', {
            productId: product.id,
            farmerId: product.farmer_id,
          });
        }
      } catch (err) {
        logger.error('[expiry-job] Failed to process product', {
          productId: product.id,
          error: err.message,
        });
        skipped++;
      }
    }

    // If we got fewer than BATCH_SIZE, we've reached the end
    if (batch.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  logger.info('[expiry-job] Deactivation complete', { cutoff, deactivated, notified, skipped });
  return { date: cutoff, deactivated, notified, skipped };
}

/**
 * Fetch a page of active, expired, not-yet-notified products with farmer info.
 */
async function fetchExpiredBatch(cutoff, offset, limit) {
  if (db.isPostgres) {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.best_before, p.farmer_id,
              u.name AS farmer_name, u.email AS farmer_email
       FROM products p
       JOIN users u ON p.farmer_id = u.id
       WHERE p.active = true
         AND p.best_before < $1::date
         AND p.expiry_notified_at IS NULL
       ORDER BY p.id
       LIMIT $2 OFFSET $3`,
      [cutoff, limit, offset]
    );
    return rows;
  } else {
    return db
      .prepare(
        `SELECT p.id, p.name, p.best_before, p.farmer_id,
                u.name AS farmer_name, u.email AS farmer_email
         FROM products p
         JOIN users u ON p.farmer_id = u.id
         WHERE p.active = 1
           AND p.best_before < ?
           AND p.expiry_notified_at IS NULL
         ORDER BY p.id
         LIMIT ? OFFSET ?`
      )
      .all(cutoff, limit, offset);
  }
}

/**
 * Atomically deactivate a single product and mark it notified, then send email.
 * The UPDATE uses a WHERE clause that re-checks the idempotency guard so concurrent
 * runs cannot double-process the same row.
 */
async function processProduct(product, cutoff) {
  const now = new Date().toISOString();

  let updated;
  if (db.isPostgres) {
    const { rowCount } = await db.query(
      `UPDATE products
       SET active = false, expiry_notified_at = $1
       WHERE id = $2
         AND active = true
         AND best_before < $3::date
         AND expiry_notified_at IS NULL`,
      [now, product.id, cutoff]
    );
    updated = rowCount;
  } else {
    const { rowCount } = await db.query(
      `UPDATE products
       SET active = 0, expiry_notified_at = ?
       WHERE id = ?
         AND active = 1
         AND best_before < ?
         AND expiry_notified_at IS NULL`,
      [now, product.id, cutoff]
    );
    updated = rowCount;
  }

  if (updated === 0) {
    // Another concurrent run already processed this product — skip silently
    logger.debug('[expiry-job] Product already processed, skipping', { productId: product.id });
    return;
  }

  logger.info('[expiry-job] Product deactivated', {
    productId: product.id,
    bestBefore: product.best_before,
  });

  if (product.farmer_email) {
    await sendProductExpiredEmail({
      product: { id: product.id, name: product.name, best_before: product.best_before },
      farmer: { name: product.farmer_name, email: product.farmer_email },
    });
  }
}

function startExpiryJob() {
  // Run daily at 02:00 UTC
  cron.schedule('0 2 * * *', () => {
    deactivateExpiredProducts().catch((err) =>
      logger.error('[expiry-job] Job error', { message: err.message })
    );
  }, { timezone: 'UTC' });
  logger.info('[expiry-job] Cron job scheduled (daily at 02:00 UTC)');
}

module.exports = { startExpiryJob, deactivateExpiredProducts, todayUTC };
