const cron = require('node-cron');
const db = require('../db/schema');
const { sendPayment } = require('../utils/stellar');
const { nextOrderDate } = require('../routes/subscriptions');

async function processSubscriptions() {
  const now = new Date().toISOString();
  const due = db
    .prepare(
      `
    SELECT s.*, u.stellar_public_key as buyer_wallet, u.stellar_secret_key as buyer_secret,
           p.price, p.name as product_name,
           fu.stellar_public_key as farmer_wallet
    FROM subscriptions s
    JOIN users u ON s.buyer_id = u.id
    JOIN products p ON s.product_id = p.id
    JOIN users fu ON p.farmer_id = fu.id
    WHERE s.status = 'active' AND s.next_order_at <= ?
  `
    )
    .all(now);

  if (due.length === 0) return;
  console.log(`[subscriptions] Processing ${due.length} due subscription(s)`);

  for (const sub of due) {
    const totalPrice = sub.price * sub.quantity;

    // Atomic stock check + decrement
    const reserve = db.transaction(() => {
      const deducted = db
        .prepare('UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?')
        .run(sub.quantity, sub.product_id, sub.quantity);
      if (deducted.changes === 0) throw new Error('Insufficient stock');

      const order = db
        .prepare(
          'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?)'
        )
        .run(sub.buyer_id, sub.product_id, sub.quantity, totalPrice, 'pending');
      return order.lastInsertRowid;
    });

    let orderId;
    try {
      orderId = reserve();
    } catch (e) {
      console.warn(`[subscriptions] Sub ${sub.id} skipped: ${e.message}`);
      continue;
    }

    try {
      const txHash = await sendPayment({
        senderSecret: sub.buyer_secret,
        receiverPublicKey: sub.farmer_wallet,
        amount: totalPrice,
        memo: `Sub#${sub.id}`,
      });

      db.transaction(() => {
        db.prepare('UPDATE orders SET status = ?, stellar_tx_hash = ? WHERE id = ?').run(
          'paid',
          txHash,
          orderId
        );
        db.prepare('UPDATE subscriptions SET next_order_at = ? WHERE id = ?').run(
          nextOrderDate(sub.frequency),
          sub.id
        );
      })();

      console.log(
        `[subscriptions] Sub ${sub.id} → order ${orderId} paid (${txHash.slice(0, 12)}…)`
      );
    } catch (e) {
      // Payment failed — restore stock, pause subscription
      db.transaction(() => {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
        db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(
          sub.quantity,
          sub.product_id
        );
        db.prepare("UPDATE subscriptions SET status = 'paused', active = 0 WHERE id = ?").run(
          sub.id
        );
      })();
      console.error(`[subscriptions] Sub ${sub.id} payment failed, paused: ${e.message}`);
    }
  }
}

function startSubscriptionJob() {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', () => {
    processSubscriptions().catch((e) => console.error('[subscriptions] Job error:', e.message));
  });
  console.log('[subscriptions] Cron job scheduled (hourly)');
}

module.exports = { startSubscriptionJob, processSubscriptions };
