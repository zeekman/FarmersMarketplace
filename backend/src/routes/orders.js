const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendPayment, getBalance } = require('../utils/stellar');
const { sendOrderEmails } = require('../utils/mailer');
const { err } = require('../middleware/error');

// POST /api/orders - buyer places + pays for an order
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || isNaN(quantity) || quantity < 1)
    return err(res, 400, 'product_id and a positive quantity are required', 'validation_error');

  const product = db.prepare(`
    SELECT p.*, u.stellar_public_key as farmer_wallet
    FROM products p JOIN users u ON p.farmer_id = u.id
    WHERE p.id = ?
  `).get(product_id);

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
    const deducted = db.prepare(
      'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
    ).run(qty, productId, qty);

    if (deducted.changes === 0) throw new Error('Insufficient stock');

    const order = db.prepare(
      'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?)'
    ).run(buyerId, productId, qty, total, 'pending');

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

    db.prepare('UPDATE orders SET status = ?, stellar_tx_hash = ? WHERE id = ?').run('paid', txHash, orderId);

    const farmer = db.prepare('SELECT * FROM users WHERE id = ?').get(product.farmer_id);
    sendOrderEmails({
      order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash },
      product, buyer, farmer,
    }).catch(e => console.error('Email notification failed:', e.message));

    res.json({ success: true, orderId, status: 'paid', txHash, totalPrice });
  } catch (e) {
    db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, product_id);
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
    res.status(402).json({ success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId });
  }
});

// GET /api/orders - buyer's order history
// Query params: status (pending | paid | failed)
router.get('/', auth, (req, res) => {
  const { status } = req.query;
  const VALID_STATUSES = ['pending', 'paid', 'failed'];

  let sql = `
    SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON p.farmer_id = u.id
    WHERE o.buyer_id = ?
  `;
  const params = [req.user.id];

  if (status && VALID_STATUSES.includes(status)) {
    sql += ` AND o.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY o.created_at DESC`;

  const orders = db.prepare(sql).all(...params);
  res.json({ success: true, data: orders });
});

// PATCH /api/orders/:id/status - farmer updates delivery status
const FARMER_STATUSES = ['processing', 'shipped', 'delivered'];

router.patch('/:id/status', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const { status } = req.body;
  if (!FARMER_STATUSES.includes(status))
    return err(res, 400, `Status must be one of: ${FARMER_STATUSES.join(', ')}`, 'invalid_status');

  // Verify the order belongs to this farmer's product
  const order = db.prepare(`
    SELECT o.* FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.id = ? AND p.farmer_id = ?
  `).get(req.params.id, req.user.id);

  if (!order) return err(res, 403, 'Order not found or not yours', 'forbidden');

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true, message: `Order status updated to ${status}` });
});

// GET /api/orders/sales - farmer's incoming orders
router.get('/sales', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Farmers only', 'forbidden');

  const sales = db.prepare(`
    SELECT o.*, p.name as product_name, u.name as buyer_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON o.buyer_id = u.id
    WHERE p.farmer_id = ?
    ORDER BY o.created_at DESC
  `).all(req.user.id);
  res.json({ success: true, data: sales });
});

module.exports = router;
