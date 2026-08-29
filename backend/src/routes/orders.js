const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { getBalance, sendPayment } = require('../utils/stellar');
const { sendOrderEmails, sendLowStockAlert } = require('../utils/mailer');
const { err } = require('../middleware/error');

router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id, address_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || Number.isNaN(quantity) || quantity < 1) {
    return err(res, 400, 'product_id and a positive quantity are required', 'validation_error');
  }

  const { rows: productRows } = await db.query(
    `SELECT p.*, u.stellar_public_key as farmer_wallet
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     WHERE p.id = $1`,
    [product_id]
  );
  const product = productRows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const { rows: buyerRows } = await db.query(
    'SELECT id, name, email, stellar_public_key, stellar_secret_key, referred_by, referral_bonus_sent FROM users WHERE id = $1',
    [req.user.id]
  );
  const buyer = buyerRows[0];

  const subtotal = product.price * quantity;
  const totalPrice = parseFloat((subtotal).toFixed(7));
  const balance = await getBalance(buyer.stellar_public_key);

  if (balance < totalPrice + 0.00001) {
    return res.status(402).json({
      success: false,
      message: 'Insufficient XLM balance',
      code: 'insufficient_balance',
      required: (totalPrice + 0.00001).toFixed(7),
      available: balance.toFixed(7),
    });
  }

  const { rowCount } = await db.query(
    'UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1',
    [quantity, product_id]
  );
  if (rowCount === 0) return err(res, 400, 'Insufficient stock', 'insufficient_stock');

  const { rows: orderRows } = await db.query(
    'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.user.id, product_id, quantity, totalPrice, 'pending', address_id || null]
  );
  const orderId = orderRows[0].id;

  try {
    const txHash = await sendPayment({
      senderSecret: buyer.stellar_secret_key,
      receiverPublicKey: product.farmer_wallet,
      amount: totalPrice,
      memo: `Order#${orderId}`,
    });

    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);

    const { rows: farmerRows } = await db.query('SELECT id, name, email, stellar_public_key FROM users WHERE id = $1', [product.farmer_id]);
    const farmer = farmerRows[0];

    const { rows: updatedRows } = await db.query('SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1', [product_id]);
    const updated = updatedRows[0];
    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer }).catch((e) => console.error('Low-stock alert failed:', e.message));
    }

    sendOrderEmails({
      order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash },
      product,
      buyer,
      farmer,
    }).catch((e) => console.error('Email notification failed:', e.message));

    return res.json({ success: true, orderId, status: 'paid', txHash, totalPrice });
  } catch (error) {
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);

    if (error.code === 'account_not_found') {
      return res.status(402).json({ success: false, message: 'Please fund your wallet before purchasing', code: 'unfunded_account', orderId });
    }

    return res.status(402).json({ success: false, message: 'Payment failed: ' + error.message, code: 'payment_failed', orderId });
  }
});

router.get('/', auth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM orders WHERE buyer_id = $1', [req.user.id]);
  const total = parseInt(countRows[0].count, 10);

  const { rows } = await db.query(
    `SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );

  res.json({ success: true, data: rows, total, page, limit, totalPages: Math.ceil(total / limit) || 0 });
});

router.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can view sales', 'forbidden');

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count
     FROM orders o
     JOIN products p ON p.id = o.product_id
     WHERE p.farmer_id = $1`,
    [req.user.id]
  );
  const total = parseInt(countRows[0].count, 10);

  const { rows } = await db.query(
    `SELECT o.*
     FROM orders o
     JOIN products p ON p.id = o.product_id
     WHERE p.farmer_id = $1
     ORDER BY o.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );

  res.json({ success: true, data: rows, total, page, limit, totalPages: Math.ceil(total / limit) || 0 });
});

module.exports = router;
