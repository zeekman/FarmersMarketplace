const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendPayment, getBalance } = require('../utils/stellar');
const { sendOrderEmails } = require('../utils/mailer');

const cacheResponse = (key, statusCode, body) => {
  const status = JSON.stringify(statusCode);
  const bodyStr = JSON.stringify(body);
  db.prepare(`
    INSERT OR REPLACE INTO idempotency (\`key\`, status, body, expires)
    VALUES (?, ?, ?, datetime('now', '+24 hours'))
  `).run(key, status, bodyStr);
};

const getCachedResponse = (key) => {
  const cached = db.prepare(
    'SELECT status, body FROM idempotency WHERE \`key\` = ? AND expires > datetime("now")'
  ).get(key);
  if (cached) {
    const status = parseInt(cached.status);
    const body = JSON.parse(cached.body);
    return { status, body };
  }
  return null;
};

// POST /api/orders - buyer places + pays for an order (idempotent)
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer')
    return res.status(403).json({ error: 'Only buyers can place orders' });

  const idempotencyKey = req.get('Idempotency-Key') || '';
  if (idempotencyKey) {
    const cached = getCachedResponse(idempotencyKey);
    if (cached) {
      return res.status(cached.status).json(cached.body);
    }
  }

  const { product_id, weight: weightStr } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  const weight = weightStr ? parseFloat(weightStr) : null;
  if (isNaN(weight)) weight = null;
  if (!product_id || isNaN(quantity) || quantity < 1) {
    const status = 400;
    const body = { error: 'product_id and a positive quantity are required' };
    if (idempotencyKey) cacheResponse(idempotencyKey, status, body);
    return res.status(status).json(body);
  }

  const product = db.prepare(`
    SELECT p.*, u.stellar_public_key as farmer_wallet
    FROM products p JOIN users u ON p.farmer_id = u.id
    WHERE p.id = ?
  `).get(product_id);

  if (!product) {
    const status = 404;
    const body = { error: 'Product not found' };
    if (idempotencyKey) cacheResponse(idempotencyKey, status, body);
    return res.status(status).json(body);
  }

  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const totalPrice = product.price * quantity;

  const balance = await getBalance(buyer.stellar_public_key);
  const required = totalPrice + 0.00001;
  if (balance < required) {
    const status = 402;
    const body = {
      error: 'Insufficient XLM balance',
      required: required.toFixed(7),
      available: balance.toFixed(7),
    };
    if (idempotencyKey) cacheResponse(idempotencyKey, status, body);
    return res.status(status).json(body);
  }

  const reserveStock = db.transaction((buyerId, productId, qty, total) => {
    const deducted = db.prepare(
      'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
    ).run(qty, productId, qty);

    if (deducted.changes === 0) throw new Error('Insufficient stock');

    const order = db.prepare(
'INSERT INTO orders (buyer_id, product_id, quantity, weight, total_price, status) VALUES (?, ?, ?, ?, ?, ?)'
).run(buyerId, productId, qty, weight, total, 'pending');

    return order.lastInsertRowid;
  });

  let orderId;
  try {
    orderId = reserveStock(req.user.id, product_id, quantity, totalPrice);
  } catch (err) {
    const status = 400;
    const body = { error: err.message };
    if (idempotencyKey) cacheResponse(idempotencyKey, status, body);
    return res.status(status).json(body);
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
      product,
      buyer,
      farmer,
    }).catch(err => console.error('Email notification failed:', err.message));

    const status = 200;
    const body = { orderId, status: 'paid', txHash, totalPrice };
    if (idempotencyKey) cacheResponse(idempotencyKey, status, body);
    res.status(status).json(body);
  } catch (err) {
    db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, product_id);
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
    const status = 402;
    const body = { error: 'Payment failed: ' + err.message, orderId };
    if (idempotencyKey) cacheResponse(idempotencyKey, status, body);
    res.status(status).json(body);
  }
});

// GET /api/orders - buyer's order history
router.get('/', auth, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON p.farmer_id = u.id
    WHERE o.buyer_id = ?
    ORDER BY o.created_at DESC
  `).all(req.user.id);
  res.json(orders);
});

// GET /api/orders/sales - farmer's incoming orders
router.get('/sales', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return res.status(403).json({ error: 'Farmers only' });

  const sales = db.prepare(`
    SELECT o.*, p.name as product_name, u.name as buyer_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON o.buyer_id = u.id
    WHERE p.farmer_id = ?
    ORDER BY o.created_at DESC
  `).all(req.user.id);
  res.json(sales);
});

module.exports = router;

