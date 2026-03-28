const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  sendPayment,
  getBalance,
  createClaimableBalance,
  createPreorderClaimableBalance,
  claimBalance,
} = require('../utils/stellar');
const {
  sendOrderEmails,
  sendLowStockAlert,
  sendStatusUpdateEmail,
} = require('../utils/mailer');
const { err } = require('../middleware/error');
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');

function parsePreorderUnlockUnix(preorderDeliveryDate) {
  const ms = Date.parse(`${preorderDeliveryDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function hasReachedDeliveryDate(preorderDeliveryDate) {
  const unlockUnix = parsePreorderUnlockUnix(preorderDeliveryDate);
  if (!unlockUnix) return false;
  return Math.floor(Date.now() / 1000) >= unlockUnix;
}

// POST /api/orders - buyer places + pays for an order
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') {
    return err(res, 403, 'Only buyers can place orders', 'forbidden');
  }

const { sendPayment, getBalance, createClaimableBalance, claimBalance } = require('../utils/stellar');
const { sendOrderEmails, sendStatusUpdateEmail, sendLowStockAlert } = require('../utils/mailer');
const { err } = require('../middleware/error');
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order placement and management
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Place and pay for an order (buyer only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-idempotency-key
 *         schema: { type: string }
 *         description: Optional idempotency key to prevent duplicate orders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, quantity]
 *             properties:
 *               product_id: { type: integer }
 *               quantity: { type: integer, minimum: 1 }
 *               address_id: { type: integer, description: Optional delivery address ID }
 *     responses:
 *       200:
 *         description: Order placed and payment successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 orderId: { type: integer }
 *                 status: { type: string, example: paid }
 *                 txHash: { type: string }
 *                 totalPrice: { type: number }
 *       402:
 *         description: Insufficient balance or payment failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Only buyers can place orders
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// POST /api/orders
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id, address_id } = req.body;
  const quantity = parseInt(req.body.quantity, 10);
  if (!product_id || Number.isNaN(quantity) || quantity < 1) {
    return err(res, 400, 'product_id and a positive quantity are required', 'validation_error');
  }

  const idempotencyKey = req.headers['x-idempotency-key'];
  if (idempotencyKey) {
    const cached = getCachedResponse(idempotencyKey);
    if (cached) {
      const statusCode = cached.success ? 200 : (cached.code === 'payment_failed' ? 402 : 400);
      return res.status(statusCode).json(cached);
    }
  }

  if (address_id) {
    const address = db
      .prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?')
      .get(address_id, req.user.id);
    if (!address) return err(res, 400, 'Invalid address_id', 'validation_error');
  }

  const product = db.prepare(`
    SELECT p.*, u.stellar_public_key as farmer_wallet
    FROM products p
    JOIN users u ON p.farmer_id = u.id
    WHERE p.id = ?
  `).get(product_id);

  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const buyer = db
    .prepare('SELECT id, name, email, stellar_public_key, stellar_secret_key, referred_by, referral_bonus_sent FROM users WHERE id = ?')
    .get(req.user.id);
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

  const totalPrice = product.price * quantity;
  const balance = await getBalance(buyer.stellar_public_key);
  const required = totalPrice + 0.00001;
  if (balance < required) {
    return res.status(402).json({
      success: false,
      message: 'Insufficient XLM balance',
      code: 'insufficient_balance',
      required: required.toFixed(7),
      available: balance.toFixed(7),
    });
  }

  const reserveStock = db.transaction((buyerId, productId, qty, total, addressId) => {
    const deducted = db.prepare(
      'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
    ).run(qty, productId, qty);

    if (deducted.changes === 0) throw new Error('Insufficient stock');

    const order = db.prepare(
      'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(buyerId, productId, qty, total, 'pending', addressId || null);

    return order.lastInsertRowid;
  });

  let orderId;
  try {
    orderId = reserveStock(req.user.id, product_id, quantity, totalPrice, address_id);
  } catch (e) {
    return err(res, 400, e.message, 'insufficient_stock');
  }
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
    let txHash;
    let balanceId = null;

    if (product.is_preorder && product.preorder_delivery_date) {
      const unlockAtUnix = parsePreorderUnlockUnix(product.preorder_delivery_date);
      if (!unlockAtUnix) {
        throw new Error('Invalid pre-order delivery date on product');
      }

      const hold = await createPreorderClaimableBalance({
        senderSecret: buyer.stellar_secret_key,
        farmerPublicKey: product.farmer_wallet,
        amount: totalPrice,
        unlockAtUnix,
      });
      txHash = hold.txHash;
      balanceId = hold.balanceId;

      db.prepare(
        'UPDATE orders SET status = ?, stellar_tx_hash = ?, escrow_balance_id = ?, escrow_status = ? WHERE id = ?'
      ).run('paid', txHash, balanceId, 'funded', orderId);
    } else {
      txHash = await sendPayment({
        senderSecret: buyer.stellar_secret_key,
        receiverPublicKey: product.farmer_wallet,
        amount: totalPrice,
        memo: `Order#${orderId}`,
      });

      db.prepare('UPDATE orders SET status = ?, stellar_tx_hash = ? WHERE id = ?')
        .run('paid', txHash, orderId);
    }

    const farmer = db.prepare('SELECT id, name, email, stellar_public_key FROM users WHERE id = ?')
      .get(product.farmer_id);

    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const referrer = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?')
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
        } catch (bonusErr) {
          console.error('[Referral] Failed to send bonus:', bonusErr.message);
        }
      }
    }

    sendOrderEmails({
      order: {
        id: orderId,
        quantity,
        total_price: totalPrice,
        stellar_tx_hash: txHash,
      },
      product,
      buyer,
      farmer,
    }).catch((mailErr) => console.error('Email notification failed:', mailErr.message));

    const updated = db.prepare(
      'SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = ?'
    ).get(product_id);

    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      db.prepare('UPDATE products SET low_stock_alerted = 1 WHERE id = ?').run(product_id);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer })
        .catch((lowStockErr) => console.error('Low-stock alert failed:', lowStockErr.message));
    }

    const responseData = {
      success: true,
      orderId,
      status: 'paid',
      txHash,
      totalPrice,
      preorder: !!product.is_preorder,
      preorderDeliveryDate: product.preorder_delivery_date || null,
      claimableBalanceId: balanceId,
    };

    if (idempotencyKey) cacheResponse(idempotencyKey, responseData);
    return res.json(responseData);
  } catch (e) {
    db.transaction(() => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
      db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, product_id);
    })();

    if (e.code === 'account_not_found') {
      return res.status(402).json({
        success: false,
        message: 'Please fund your wallet before purchasing',
        code: 'unfunded_account',
        orderId,
      });
    }

    const errorData = {
      success: false,
      message: 'Payment failed: ' + e.message,
      code: 'payment_failed',
      orderId,
    };
    if (idempotencyKey) cacheResponse(idempotencyKey, errorData);
    return res.status(402).json(errorData);
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

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get buyer's order history
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, paid, failed] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated order list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Order' }
 */
// GET /api/orders
router.get('/', auth, async (req, res) => {
  const { status } = req.query;
  const VALID_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'failed'];
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const conditions = ['o.buyer_id = ?'];
  const params = [req.user.id];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('o.status = ?');
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

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM orders o ${where}`)
    .get(...params).count;

  const data = db.prepare(
    `SELECT o.*, p.name as product_name, p.unit, p.is_preorder, p.preorder_delivery_date, u.name as farmer_name,
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

/**
 * @swagger
 * /api/orders/sales:
 *   get:
 *     summary: Get farmer's incoming sales
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated sales list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Order' }
 *       403:
 *         description: Farmers only
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// GET /api/orders/sales - farmer's incoming orders
router.get('/sales', auth, (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Farmers only', 'forbidden');
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const total = db
    .prepare('SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = ?')
    .get(req.user.id).count;

  const data = db.prepare(
    `SELECT o.*, p.name as product_name, p.is_preorder, p.preorder_delivery_date, u.name as buyer_name,
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
     WHERE p.farmer_id = ?
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(req.user.id, limit, offset);

  res.json({
    success: true,
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// PATCH /api/orders/:id/status - farmer updates order status
router.patch('/:id/status', auth, (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Farmers only', 'forbidden');
  }

  const VALID = ['processing', 'shipped', 'delivered'];
  const { status } = req.body;
  if (!status || !VALID.includes(status)) {
    return err(res, 400, `status must be one of: ${VALID.join(', ')}`, 'validation_error');
  }

  const order = db.prepare(`
    SELECT o.*, p.name as product_name, p.unit, u.name as buyer_name, u.email as buyer_email
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON o.buyer_id = u.id
    WHERE o.id = ? AND p.farmer_id = ?
  `).get(req.params.id, req.user.id);

  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
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
  }).catch((e) => console.error('Status email failed:', e.message));
  }).catch(e => console.error('Status email failed:', e.message));

  res.json({ success: true, message: 'Order status updated' });
});

// POST /api/orders/:id/escrow — buyer funds escrow (legacy flow)
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
  if (balance < order.total_price + 0.00001) {
    return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });
  }

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

// POST /api/orders/:id/claim — farmer claims escrow after delivery (legacy flow)
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

// POST /api/orders/:id/claim-preorder — farmer claims pre-order hold on/after delivery date
router.post('/:id/claim-preorder', auth, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Only farmers can claim pre-order payments', 'forbidden');
  }

  const order = db.prepare(`
    SELECT o.*, p.is_preorder, p.preorder_delivery_date
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.id = ? AND p.farmer_id = ?
  `).get(req.params.id, req.user.id);

  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');
  if (!order.is_preorder) return err(res, 400, 'Order is not a pre-order', 'invalid_state');
  if (!order.preorder_delivery_date) return err(res, 400, 'Pre-order delivery date is missing', 'invalid_state');
  if (order.escrow_status !== 'funded' || !order.escrow_balance_id) {
    return err(res, 400, 'No pre-order claimable balance available', 'invalid_state');
  }
  if (!hasReachedDeliveryDate(order.preorder_delivery_date)) {
    return err(res, 400, 'Cannot claim before delivery date', 'preorder_not_deliverable');
  }

  const farmer = db.prepare('SELECT stellar_secret_key FROM users WHERE id = ?').get(req.user.id);

  try {
    const txHash = await claimBalance({
      claimantSecret: farmer.stellar_secret_key,
      balanceId: order.escrow_balance_id,
    });

    db.prepare('UPDATE orders SET escrow_status = ?, stellar_tx_hash = ? WHERE id = ?')
      .run('claimed', txHash, order.id);

    return res.json({ success: true, txHash, message: 'Pre-order payment claimed' });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Claim failed: ' + e.message, code: 'claim_failed' });
  }
});

module.exports = router;
