const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendPayment, getBalance } = require('../utils/stellar');
const { sendOrderEmails, sendStatusUpdateEmail, sendLowStockAlert } = require('../utils/mailer');
const { err } = require('../middleware/error');

// POST /api/orders - buyer places + pays for an order
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || isNaN(quantity) || quantity < 1)
    return err(res, 400, 'product_id and a positive quantity are required', 'validation_error');

  const product = db
    .prepare(
      `
    SELECT p.*, u.stellar_public_key as farmer_wallet
    FROM products p JOIN users u ON p.farmer_id = u.id
    WHERE p.id = ?
  `
    )
    .get(product_id);

  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const totalPrice = product.price * quantity;

  const balance = await getBalance(buyer.stellar_public_key);
  const required = totalPrice + 0.00001;
  if (balance < required)
    return res.status(402).json({
      success: false,
      message: 'Insufficient XLM balance',
      code: 'insufficient_balance',
      required: required.toFixed(7),
      available: balance.toFixed(7),
    });

  const reserveStock = db.transaction((buyerId, productId, qty, total) => {
    const deducted = db
      .prepare('UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?')
      .run(qty, productId, qty);

    if (deducted.changes === 0) throw new Error('Insufficient stock');

    const order = db
      .prepare(
        'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?)'
      )
      .run(buyerId, productId, qty, total, 'pending');

    return order.lastInsertRowid;
  });

  let orderId;
  try {
    orderId = reserveStock(req.user.id, product_id, quantity, totalPrice);
  } catch (e) {
    return err(res, 400, e.message, 'insufficient_stock');
  }

  try {
    const txHash = await sendPayment({
      senderSecret: buyer.stellar_secret_key,
      receiverPublicKey: product.farmer_wallet,
      amount: totalPrice,
      memo: `Order#${orderId}`,
    });

    db.prepare('UPDATE orders SET status = ?, stellar_tx_hash = ? WHERE id = ?').run(
      'paid',
      txHash,
      orderId
    );

    // Referral Bonus Logic
    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const referrer = db
        .prepare('SELECT stellar_public_key FROM users WHERE id = ?')
        .get(buyer.referred_by);
      const treasurySecret = process.env.MARKETPLACE_TREASURY_SECRET;

      if (referrer && treasurySecret) {
        try {
          await sendPayment({
            senderSecret: treasurySecret,
            receiverPublicKey: referrer.stellar_public_key,
            amount: 1.0,
            memo: `Referral Bonus: ${buyer.name}`.slice(0, 28),
          });
          db.prepare('UPDATE users SET referral_bonus_sent = 1 WHERE id = ?').run(buyer.id);
          console.warn(
            `[Referral] Sent 1 XLM bonus to user ${buyer.referred_by} for referring ${buyer.id}`
          );
        } catch (bonusErr) {
          console.warn('[Referral] Failed to send bonus:', bonusErr.message);
        }
      } else if (!treasurySecret) {
        console.warn('[Referral] MARKETPLACE_TREASURY_SECRET not set, skipping bonus payout');
      }
    }

    const farmer = db.prepare('SELECT * FROM users WHERE id = ?').get(product.farmer_id);
    sendOrderEmails({
      order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash },
      product,
      buyer,
      farmer,
    }).catch((e) => console.warn('Email notification failed:', e.message));

    // Low-stock check — send alert once per threshold crossing
    const updated = db
      .prepare('SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = ?')
      .get(product_id);
    if (updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      db.prepare('UPDATE products SET low_stock_alerted = 1 WHERE id = ?').run(product_id);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer }).catch(
        (e) => console.warn('Low-stock alert failed:', e.message)
      );
    }

    res.json({ success: true, orderId, status: 'paid', txHash, totalPrice });
  } catch (e) {
    db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(
      quantity,
      product_id
    );
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
    res.status(402).json({
      success: false,
      message: 'Payment failed: ' + e.message,
      code: 'payment_failed',
      orderId,
    });
  }
});

// GET /api/orders - buyer's order history
// Query params: status (pending | paid | failed), page, limit
router.get('/', auth, (req, res) => {
  const { status } = req.query;
  const VALID_STATUSES = ['pending', 'paid', 'failed'];
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions = ['o.buyer_id = ?'];
  const params = [req.user.id];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('o.status = ?');
    params.push(status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) as count FROM orders o ${where}`).get(...params).count;

  const data = db
    .prepare(
      `SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     ${where}
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// GET /api/orders/sales - farmer's incoming orders
// Query params: page, limit
router.get('/sales', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = ?`
    )
    .get(req.user.id).count;

  const data = db
    .prepare(
      `SELECT o.*, p.name as product_name, u.name as buyer_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     WHERE p.farmer_id = ?
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(req.user.id, limit, offset);

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// PATCH /api/orders/:id/status - farmer updates order status
router.patch('/:id/status', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const VALID = ['processing', 'shipped', 'delivered'];
  const { status } = req.body;
  if (!status || !VALID.includes(status))
    return err(res, 400, `status must be one of: ${VALID.join(', ')}`, 'validation_error');

  const order = db
    .prepare(
      `SELECT o.*, p.name as product_name, p.unit, u.name as buyer_name, u.email as buyer_email
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON o.buyer_id = u.id
    WHERE o.id = ? AND p.farmer_id = ?`
    )
    .get(req.params.id, req.user.id);

  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);

  sendStatusUpdateEmail({
    order,
    product: { name: order.product_name, unit: order.unit },
    buyer: { name: order.buyer_name, email: order.buyer_email },
    newStatus: status,
  }).catch((e) => console.warn('Status email failed:', e.message));

  res.json({ success: true, message: 'Order status updated' });
});

module.exports = router;
