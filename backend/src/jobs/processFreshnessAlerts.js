const cron = require('node-cron');
const db = require('../db/schema');
const { sendFreshnessAlert } = require('../utils/mailer');
const { sendPushToUser } = require('../utils/pushNotifications');

function getAlertDays() {
  const val = parseInt(process.env.FRESHNESS_ALERT_DAYS, 10);
  return Number.isFinite(val) && val > 0 ? val : 3;
}

function groupByProduct(rows) {
  const map = new Map();
  for (const { product_id, buyer_id } of rows) {
    const pid = Number(product_id);
    if (!map.has(pid)) map.set(pid, new Set());
    map.get(pid).add(buyer_id);
  }
  return map;
}

async function runFreshnessAlerts() {
  const alertDays = getAlertDays();
  console.log(`[freshness] Checking for products expiring within ${alertDays} day(s)...`);

  let expiringProducts;
  if (db.isPostgres) {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.best_before, p.farmer_id,
              u.name AS farmer_name, u.email AS farmer_email
       FROM products p
       JOIN users u ON p.farmer_id = u.id
       WHERE p.best_before >= CURRENT_DATE
         AND p.best_before <= CURRENT_DATE + ($1 * INTERVAL '1 day')
         AND p.expiry_notified_at IS NULL`,
      [alertDays]
    );
    expiringProducts = rows;
  } else {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.best_before, p.farmer_id,
              u.name AS farmer_name, u.email AS farmer_email
       FROM products p
       JOIN users u ON p.farmer_id = u.id
       WHERE p.best_before >= date('now')
         AND p.best_before <= date('now', '+' || $1 || ' days')
         AND p.expiry_notified_at IS NULL`,
      [alertDays]
    );
    expiringProducts = rows;
  }

  if (expiringProducts.length === 0) {
    console.log(`[freshness] No products expiring within ${alertDays} day(s)`);
    return;
  }

  console.log(`[freshness] Processing ${expiringProducts.length} expiring product(s)`);

  const productIds = expiringProducts.map((p) => p.id);

  // Fetch all interested buyers for qualifying products in one query — avoids N+1
  let buyersByProduct = new Map();
  if (db.isPostgres) {
    const { rows: buyerRows } = await db.query(
      `SELECT DISTINCT buyer_id, product_id FROM (
         SELECT buyer_id, product_id FROM favorites WHERE product_id = ANY($1)
         UNION
         SELECT buyer_id, product_id FROM subscriptions
         WHERE product_id = ANY($1) AND active = true AND status = 'active'
       ) interested`,
      [productIds]
    );
    buyersByProduct = groupByProduct(buyerRows);
  } else {
    const ph1 = productIds.map((_, i) => `$${i + 1}`).join(', ');
    const offset = productIds.length;
    const ph2 = productIds.map((_, i) => `$${offset + i + 1}`).join(', ');
    const { rows: buyerRows } = await db.query(
      `SELECT DISTINCT buyer_id, product_id FROM (
         SELECT buyer_id, product_id FROM favorites WHERE product_id IN (${ph1})
         UNION
         SELECT buyer_id, product_id FROM subscriptions
         WHERE product_id IN (${ph2}) AND active = 1 AND status = 'active'
       ) interested`,
      [...productIds, ...productIds]
    );
    buyersByProduct = groupByProduct(buyerRows);
  }

  for (const product of expiringProducts) {
    try {
      const bestBefore = new Date(product.best_before);
      const now = new Date();
      const daysLeft = Math.max(0, Math.floor((bestBefore - now) / (24 * 60 * 60 * 1000)));

      // Notify farmer via email
      try {
        await sendFreshnessAlert({
          product,
          farmer: { name: product.farmer_name, email: product.farmer_email },
          daysLeft,
        });
      } catch (e) {
        console.error(
          `[freshness] Failed to alert farmer ${product.farmer_email} for product ${product.id}:`,
          e.message
        );
      }

      // Notify interested buyers via push (deduplication guaranteed by the Set)
      const buyers = buyersByProduct.get(product.id) || new Set();
      for (const buyerId of buyers) {
        try {
          await sendPushToUser(buyerId, {
            title: 'Freshness Alert',
            body: `${product.name} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — order now!`,
          });
        } catch (e) {
          console.error(
            `[freshness] Failed to notify buyer ${buyerId} for product ${product.id}:`,
            e.message
          );
        }
      }

      // Advance the timestamp after all notifications have been attempted.
      // If the DB update itself throws, the outer catch prevents the stamp from being set,
      // so the job will retry this product on the next execution.
      const nowExpr = db.isPostgres ? 'NOW()' : "datetime('now')";
      await db.query(
        `UPDATE products SET expiry_notified_at = ${nowExpr} WHERE id = $1`,
        [product.id]
      );
    } catch (e) {
      console.error(`[freshness] Unexpected error processing product ${product.id}:`, e.message);
    }
  }
}

async function processFreshnessAlerts() {
  cron.schedule('0 9 * * *', async () => {
    await runFreshnessAlerts();
  });
}

function startFreshnessJob() {
  processFreshnessAlerts();
  console.log('[freshness] Cron job scheduled (daily at 9 AM)');
}

module.exports = { startFreshnessJob, processFreshnessAlerts, runFreshnessAlerts };
