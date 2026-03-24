const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { sendPayment } = require('../stellar');
const validate = require('../middleware/validate');
const { sendPayment, getBalance } = require('../stellar');

// POST /api/orders - buyer places + pays for an order
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer')
    return res.status(403).json({ error: 'Only buyers can place orders' });

  const { product_id, quantity } = req.body;
  const { product_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || isNaN(quantity) || quantity < 1)
    return res.status(400).json({ error: 'product_id and a positive quantity are required' });

  const product = db.prepare(`
    SELECT p.*, u.stellar_public_key as farmer_wallet
    FROM products p JOIN users u ON p.farmer_id = u.id
    WHERE p.id = ?
  `).get(product_id);

  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });

  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const totalPrice = product.price * quantity;

  // Verify buyer has sufficient XLM balance (amount + network fee)
  const balance = await getBalance(buyer.stellar_public_key);
  const required = totalPrice + 0.00001;
  if (balance < required)
    return res.status(402).json({
      error: 'Insufficient XLM balance',
      required: required.toFixed(7),
      available: balance.toFixed(7),
    });

  // Create order as pending
  const order = db.prepare(
    'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, product_id, quantity, totalPrice, 'pending');

  const orderId = order.lastInsertRowid;

  try {
    // Execute Stellar payment
    const txHash = await sendPayment({
      senderSecret: buyer.stellar_secret_key,
      receiverPublicKey: product.farmer_wallet,
      amount: totalPrice,
      memo: `Order#${orderId}`,
    });

    // Update order and reduce stock
    db.prepare('UPDATE orders SET status = ?, stellar_tx_hash = ? WHERE id = ?').run('paid', txHash, orderId);
    db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?').run(quantity, product_id);

    res.json({ orderId, status: 'paid', txHash, totalPrice });
  } catch (err) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
    res.status(402).json({ error: 'Payment failed: ' + err.message, orderId });
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
