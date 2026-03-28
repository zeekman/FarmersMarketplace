const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendPayment, getBalance, createClaimableBalance, claimBalance } = require('../utils/stellar');
const { sendOrderEmails, sendStatusUpdateEmail, sendLowStockAlert } = require('../utils/mailer');
const { err } = require('../middleware/error');
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');

// POST /api/orders
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id, address_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || isNaN(quantity) || quantity < 1)
    return err(res, 400, 'product_id and a positive quantity are required', 'validation_error');

  const idempotencyKey = req.headers['x-idempotency-key'];
  const cached = await getCachedResponse(idempotencyKey);
  if (cached) return res.status(cached.success ? 200 : 402).json(cached);

  if (address_id) {
    const { rows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [address_id, req.user.id]);
    if (!rows[0]) return err(res, 400, 'Invalid address_id', 'validation_error');
  }

  const { rows: pRows } = await db.query(
    `SELECT p.*, u.stellar_public_key as farmer_wallet FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = $1`,
    [product_id]
  );
  const product = pRows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const { rows: bRows } = await db.query(
    'SELECT id, name, email, stellar_public_key, stellar_secret_key, referred_by, referral_bonus_sent FROM users WHERE id = $1',
    [req.user.id]
  );
  const buyer = bRows[0];
  const totalPrice = product.price * quantity;

  const balance = await getBalance(buyer.stellar_public_key);
  if (balance < totalPrice + 0.00001)
    return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance', required: (totalPrice + 0.00001).toFixed(7), available: balance.toFixed(7) });

  // Atomic stock decrement
  const { rowCount } = await db.query(
    'UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1',
    [quantity, product_id]
  );
  if (rowCount === 0) return err(res, 400, 'Insufficient stock', 'insufficient_stock');

  const { rows: oRows } = await db.query(
    'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.user.id, product_id, quantity, totalPrice, 'pending', address_id || null]
  );
  const orderId = oRows[0].id;

  try {
    const txHash = await sendPayment({
      senderSecret: buyer.stellar_secret_key,
      receiverPublicKey: product.farmer_wallet,
      amount: totalPrice,
      memo: `Order#${orderId}`,
    });

    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);

    // Referral bonus
    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const { rows: refRows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [buyer.referred_by]);
      const treasurySecret = process.env.MARKETPLACE_TREASURY_SECRET;
      if (refRows[0] && treasurySecret) {
        sendPayment({ senderSecret: treasurySecret, receiverPublicKey: refRows[0].stellar_public_key, amount: 1.0, memo: `Referral Bonus: ${buyer.name}`.slice(0, 28) })
          .then(() => db.query('UPDATE users SET referral_bonus_sent = 1 WHERE id = $1', [buyer.id]))
          .catch(e => console.error('[Referral] Failed to send bonus:', e.message));
      }
    }

    const { rows: fRows } = await db.query('SELECT id, name, email, stellar_public_key FROM users WHERE id = $1', [product.farmer_id]);
    sendOrderEmails({ order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash }, product, buyer, farmer: fRows[0] })
      .catch(e => console.error('Email notification failed:', e.message));

    // Low-stock check
    const { rows: updRows } = await db.query('SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1', [product_id]);
    const updated = updRows[0];
    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer: fRows[0] })
        .catch(e => console.error('Low-stock alert failed:', e.message));
    }

    const responseData = { success: true, orderId, status: 'paid', txHash, totalPrice };
    await cacheResponse(idempotencyKey, responseData);
    res.json(responseData);
  } catch (e) {
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);
    if (e.code === 'account_not_found')
      return res.status(402).json({ success: false, message: 'Please fund your wallet before purchasing', code: 'unfunded_account', orderId });
    const errorData = { success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId };
    await cacheResponse(idempotencyKey, errorData);
    res.status(402).json(errorData);
  }
});

// GET /api/orders
router.get('/', auth, async (req, res) => {
  const { status } = req.query;
  const VALID_STATUSES = ['pending', 'paid', 'failed'];
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions = ['o.buyer_id = $1'];
  const params = [req.user.id];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push(`o.status = $${params.length + 1}`);
    params.push(status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows: countRows } = await db.query(`SELECT COUNT(*) as count FROM orders o ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name,
            a.label as address_label, a.street as address_street, a.city as address_city,
            a.country as address_country, a.postal_code as address_postal_code
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN addresses a ON o.address_id = a.id
     ${where}
     ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// GET /api/orders/sales
router.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1`,
    [req.user.id]
  );
  const total = parseInt(countRows[0].count);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, u.name as buyer_name,
            a.label as address_label, a.street as address_street, a.city as address_city,
            a.country as address_country, a.postal_code as address_postal_code
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     LEFT JOIN addresses a ON o.address_id = a.id
     WHERE p.farmer_id = $1
     ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const VALID = ['processing', 'shipped', 'delivered'];
  const { status } = req.body;
  if (!status || !VALID.includes(status)) return err(res, 400, `status must be one of: ${VALID.join(', ')}`, 'validation_error');

  const { rows } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, u.name as buyer_name, u.email as buyer_email
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     WHERE o.id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');

  await db.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);

  sendStatusUpdateEmail({
    order,
    product: { name: order.product_name, unit: order.unit },
    buyer: { name: order.buyer_name, email: order.buyer_email },
    newStatus: status,
  }).catch(e => console.error('Status email failed:', e.message));

  res.json({ success: true, message: 'Order status updated' });
});

// POST /api/orders/:id/escrow
router.post('/:id/escrow', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can fund escrow', 'forbidden');

  const { rows } = await db.query(
    `SELECT o.*, p.farmer_id, u.stellar_public_key as farmer_wallet
     FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON p.farmer_id = u.id
     WHERE o.id = $1`,
    [req.params.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (order.buyer_id !== req.user.id) return err(res, 403, 'Not your order', 'forbidden');
  if (order.escrow_status !== 'none') return err(res, 400, 'Escrow already initiated', 'invalid_state');

  const { rows: bRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const buyer = bRows[0];
  const balance = await getBalance(buyer.stellar_public_key);
  if (balance < order.total_price + 0.00001)
    return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });

  try {
    const { txHash, balanceId } = await createClaimableBalance({
      senderSecret: buyer.stellar_secret_key,
      farmerPublicKey: order.farmer_wallet,
      buyerPublicKey: buyer.stellar_public_key,
      amount: order.total_price,
    });
    await db.query('UPDATE orders SET escrow_balance_id = $1, escrow_status = $2, stellar_tx_hash = $3 WHERE id = $4', [balanceId, 'funded', txHash, order.id]);
    res.json({ success: true, balanceId, txHash });
  } catch (e) {
    res.status(402).json({ success: false, message: 'Escrow creation failed: ' + e.message, code: 'escrow_failed' });
  }
});

// POST /api/orders/:id/claim
router.post('/:id/claim', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can claim escrow', 'forbidden');

  const { rows } = await db.query(
    `SELECT o.* FROM orders o JOIN products p ON o.product_id = p.id WHERE o.id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');
  if (order.escrow_status !== 'funded') return err(res, 400, 'No funded escrow on this order', 'invalid_state');
  if (order.status !== 'delivered') return err(res, 400, 'Order must be marked delivered before claiming', 'invalid_state');

  const { rows: fRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const farmer = fRows[0];

  try {
    const txHash = await claimBalance({ claimantSecret: farmer.stellar_secret_key, balanceId: order.escrow_balance_id });
    await db.query('UPDATE orders SET escrow_status = $1, stellar_tx_hash = $2 WHERE id = $3', ['claimed', txHash, order.id]);
    res.json({ success: true, txHash });
  } catch (e) {
    res.status(402).json({ success: false, message: 'Claim failed: ' + e.message, code: 'claim_failed' });
  }
});

module.exports = router;
