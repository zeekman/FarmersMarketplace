const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendPayment, getBalance } = require('../utils/stellar');
const { sendOrderEmails, sendLowStockAlert, sendStatusUpdateEmail } = require('../utils/mailer');
const { sendPayment, getBalance, createClaimableBalance, claimBalance } = require('../utils/stellar');
const { sendOrderEmails, sendStatusUpdateEmail, sendLowStockAlert } = require('../utils/mailer');
const { err } = require('../middleware/error');
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');

// POST /api/orders - buyer places + pays for an order
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id, address_id } = req.body;
  const idempotencyKey = req.headers['x-idempotency-key'];
  const cached = getCachedResponse(idempotencyKey);
  if (cached) {
    console.log(`[Idempotency] Returning cached response for key: ${idempotencyKey}`);
    return res.status(cached.success ? 200 : (cached.code === 'payment_failed' ? 402 : 400)).json(cached);
  }

  const { product_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || isNaN(quantity) || quantity < 1)
    return err(res, 400, 'product_id and a positive quantity are required', 'validation_error');

  // Validate address if provided
  if (address_id) {
    const address = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(address_id, req.user.id);
    if (!address) return err(res, 400, 'Invalid address_id', 'validation_error');
  }

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
    // Atomic stock check + decrement: single UPDATE with WHERE quantity >= ? prevents race conditions.
    // If multiple concurrent requests try to buy the last units, only one succeeds (changes > 0).
    // Others fail because quantity no longer meets the WHERE condition (changes === 0).
    const deducted = db.prepare(
      'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
    ).run(qty, productId, qty);

    if (deducted.changes === 0) throw new Error('Insufficient stock');

    const order = db.prepare(
      'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(buyerId, productId, qty, total, 'pending', address_id || null);

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

    // Referral Bonus Logic
    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const referrer = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(buyer.referred_by);
      const treasurySecret = process.env.MARKETPLACE_TREASURY_SECRET;
      
      if (referrer && treasurySecret) {
        try {
          await sendPayment({
            senderSecret: treasurySecret,
            receiverPublicKey: referrer.stellar_public_key,
            amount: 1.0,
            memo: `Referral Bonus: ${buyer.name}`.slice(0, 28)
          });
          db.prepare('UPDATE users SET referral_bonus_sent = 1 WHERE id = ?').run(buyer.id);
          console.log(`[Referral] Sent 1 XLM bonus to user ${buyer.referred_by} for referring ${buyer.id}`);
        } catch (err) {
          console.error('[Referral] Failed to send bonus:', err.message);
        }
      } else if (!treasurySecret) {
        console.warn('[Referral] MARKETPLACE_TREASURY_SECRET not set, skipping bonus payout');
      }
    }

    const farmer = db.prepare('SELECT * FROM users WHERE id = ?').get(product.farmer_id);
    sendOrderEmails({
      order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash },
      product, buyer, farmer,
    }).catch(e => console.error('Email notification failed:', e.message));

    // Low-stock check — send alert once per threshold crossing
    const updated = db.prepare('SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = ?').get(product_id);
    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      db.prepare('UPDATE products SET low_stock_alerted = 1 WHERE id = ?').run(product_id);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer })
        .catch(e => console.error('Low-stock alert failed:', e.message));
    }

    const responseData = { success: true, orderId, status: 'paid', txHash, totalPrice };
    cacheResponse(idempotencyKey, responseData);
    res.json(responseData);
  } catch (e) {
    db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, product_id);
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
    const errorData = { success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId };
    cacheResponse(idempotencyKey, errorData);
    res.status(402).json(errorData);
  }
});

// GET /api/orders - buyer's order history
router.get('/', auth, (req, res) => {
  const { status } = req.query;
  const VALID_STATUSES = ['pending', 'paid', 'failed'];
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions = ['o.buyer_id = ?'];
  const params = [req.user.id];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('o.status = ?');
    params.push(status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM orders o ${where}`
  ).get(...params).count;

  const data = db.prepare(
    `SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name,
            a.label as address_label, a.street as address_street, a.city as address_city,
            a.country as address_country, a.postal_code as address_postal_code
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN addresses a ON o.address_id = a.id
     ${where}
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// GET /api/orders/sales - farmer's incoming orders
router.get('/sales', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Farmers only', 'forbidden');

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = ?`
  ).get(req.user.id).count;

  const data = db.prepare(
    `SELECT o.*, p.name as product_name, u.name as buyer_name,
            a.label as address_label, a.street as address_street, a.city as address_city,
            a.country as address_country, a.postal_code as address_postal_code
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     LEFT JOIN addresses a ON o.address_id = a.id
     WHERE p.farmer_id = ?
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(req.user.id, limit, offset);

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// PATCH /api/orders/:id/status - farmer updates order status
router.patch('/:id/status', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Farmers only', 'forbidden');

  const VALID = ['processing', 'shipped', 'delivered'];
  const { status } = req.body;
  if (!status || !VALID.includes(status))
    return err(res, 400, `status must be one of: ${VALID.join(', ')}`, 'validation_error');

  const order = db.prepare(`
    SELECT o.*, p.name as product_name, p.unit, u.name as buyer_name, u.email as buyer_email
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON o.buyer_id = u.id
    WHERE o.id = ? AND p.farmer_id = ?
  `).get(req.params.id, req.user.id);

  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);

  sendStatusUpdateEmail({
    order,
    product: { name: order.product_name, unit: order.unit },
    buyer: { name: order.buyer_name, email: order.buyer_email },
    newStatus: status,
  }).catch(e => console.error('Status email failed:', e.message));

  res.json({ success: true, message: 'Order status updated' });
});

// POST /api/orders/:id/escrow — buyer funds escrow (claimable balance)
router.post('/:id/escrow', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can fund escrow', 'forbidden');

  const order = db.prepare(`
    SELECT o.*, p.farmer_id, u.stellar_public_key as farmer_wallet
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON p.farmer_id = u.id
    WHERE o.id = ?
  `).get(req.params.id);

  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (order.buyer_id !== req.user.id) return err(res, 403, 'Not your order', 'forbidden');
  if (order.escrow_status !== 'none') return err(res, 400, 'Escrow already initiated', 'invalid_state');

  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
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

    db.prepare('UPDATE orders SET escrow_balance_id = ?, escrow_status = ?, stellar_tx_hash = ? WHERE id = ?')
      .run(balanceId, 'funded', txHash, order.id);

    res.json({ success: true, balanceId, txHash });
  } catch (e) {
    res.status(402).json({ success: false, message: 'Escrow creation failed: ' + e.message, code: 'escrow_failed' });
  }
});

// POST /api/orders/:id/claim — farmer claims escrow after delivery
router.post('/:id/claim', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can claim escrow', 'forbidden');

  const order = db.prepare(`
    SELECT o.* FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.id = ? AND p.farmer_id = ?
  `).get(req.params.id, req.user.id);

  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');
  if (order.escrow_status !== 'funded') return err(res, 400, 'No funded escrow on this order', 'invalid_state');
  if (order.status !== 'delivered') return err(res, 400, 'Order must be marked delivered before claiming', 'invalid_state');

  const farmer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  try {
    const txHash = await claimBalance({
      claimantSecret: farmer.stellar_secret_key,
      balanceId: order.escrow_balance_id,
    });

    db.prepare('UPDATE orders SET escrow_status = ?, stellar_tx_hash = ? WHERE id = ?')
      .run('claimed', txHash, order.id);

    res.json({ success: true, txHash });
  } catch (e) {
    res.status(402).json({ success: false, message: 'Claim failed: ' + e.message, code: 'claim_failed' });
  }
});

module.exports = router;
