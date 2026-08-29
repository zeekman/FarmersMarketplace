const db = require('../db/schema');
const { getTransactions } = require('../utils/stellar');
const logger = require('../logger');

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 60000;

async function confirmPendingOrders() {
  const confirming = db
    .prepare(
      `SELECT o.*, u.stellar_public_key
     FROM orders o JOIN users u ON o.buyer_id = u.id
     WHERE o.status = 'confirming' AND o.stellar_tx_hash IS NOT NULL`
    )
    .all();

  for (const order of confirming) {
    const submittedAt = new Date(order.tx_submitted_at).getTime();
    if (Date.now() - submittedAt > TIMEOUT_MS) {
      db.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`).run(order.id);
      db.prepare(`UPDATE products SET quantity = quantity + ? WHERE id = ?`).run(
        order.quantity,
        order.product_id
      );
      logger.info(`[confirm] Order ${order.id} timed out`);
      continue;
    }

    try {
      const txs = await getTransactions(order.stellar_public_key);
      const confirmed = txs.some((tx) => tx.hash === order.stellar_tx_hash);
      if (confirmed) {
        db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(order.id);
        logger.info(`[confirm] Order ${order.id} confirmed — TX ${order.stellar_tx_hash}`);
      }
    } catch (e) {
      logger.error(`[confirm] Error checking order ${order.id}`, { error: e.message });
    }
  }
}

function start() {
  setInterval(confirmPendingOrders, POLL_INTERVAL_MS);
  logger.info('[confirm] Payment confirmation job started');
}

module.exports = { start, confirmPendingOrders };