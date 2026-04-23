const cron = require('node-cron');
const db = require('../db/schema');
const { sendFreshnessAlert } = require('../utils/mailer');

async function processFreshnessAlerts() {
  // Run daily at 9 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[freshness] Checking for products expiring soon...');

    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    const dateStr = twoDaysFromNow.toISOString().split('T')[0]; // YYYY-MM-DD

    let expiringProducts;
    if (db.isPostgres) {
      const { rows } = await db.query(
        `SELECT p.*, u.name as farmer_name, u.email as farmer_email
         FROM products p
         JOIN users u ON p.farmer_id = u.id
         WHERE p.best_before = $1`,
        [dateStr]
      );
      expiringProducts = rows;
    } else {
      expiringProducts = db.prepare(
        `SELECT p.*, u.name as farmer_name, u.email as farmer_email
         FROM products p
         JOIN users u ON p.farmer_id = u.id
         WHERE p.best_before = ?`
      ).all(dateStr);
    }

    if (expiringProducts.length === 0) {
      console.log('[freshness] No products expiring in 2 days');
      return;
    }

    console.log(`[freshness] Alerting farmers about ${expiringProducts.length} expiring product(s)`);

    for (const product of expiringProducts) {
      try {
        await sendFreshnessAlert({
          product,
          farmer: { name: product.farmer_name, email: product.farmer_email },
          daysLeft: 2,
        });
      } catch (e) {
        console.error(`[freshness] Failed to alert farmer ${product.farmer_email} for product ${product.id}:`, e.message);
      }
    }
  });
}

function startFreshnessJob() {
  processFreshnessAlerts();
  console.log('[freshness] Cron job scheduled (daily at 9 AM)');
}

module.exports = { startFreshnessJob, processFreshnessAlerts };