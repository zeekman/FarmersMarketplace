const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  sendPayment,
  pathPayment,
  getPathPaymentEstimate,
  getBalance,
  getPlatformFeeInfo,
  createClaimableBalance,
  createPreorderClaimableBalance,
  claimBalance,
  mintRewardTokens,
  invokeEscrowContract,
} = require('../utils/stellar');
const {
  sendOrderEmails,
  sendLowStockAlert,
  sendStatusUpdateEmail,
} = require('../utils/mailer');
const { sendPushToUser } = require('../utils/pushNotifications');
const { err } = require('../middleware/error');
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');
const { resolveCoupon, calcDiscount } = require('./coupons');

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

// Get the best matching tier price for a quantity, or base price if no tiers
async function getTierPrice(productId, quantity) {
  const { rows: tiers } = await db.query(
    'SELECT min_quantity, price_per_unit FROM price_tiers WHERE product_id = $1 ORDER BY min_quantity DESC',
    [productId]
  );

  // Find the highest min_quantity that is <= quantity
  for (const tier of tiers) {
    if (quantity >= tier.min_quantity) {
      return tier.price_per_unit;
    }
  }

  // No tier matches, return base price
  const { rows: productRows } = await db.query('SELECT price FROM products WHERE id = $1', [productId]);
  return productRows[0].price;
}

function isFlashSaleActive(product) {
  if (!product?.flash_sale_price || !product?.flash_sale_ends_at) return false;
  return new Date(product.flash_sale_ends_at).getTime() > Date.now();
}

async function getEffectiveUnitPrice(product, productId, quantity) {
  if (isFlashSaleActive(product)) {
    return Number(product.flash_sale_price);
  }
  return getTierPrice(productId, quantity);
}
// GET /api/orders/fee-preview?amount=X — returns fee breakdown for a given amount
router.get('/fee-preview', (req, res) => {
  const amount = parseFloat(req.query.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount is required' });
  const info = getPlatformFeeInfo(amount);
  res.json({ success: true, total: amount, feePercent: info.feePercent, feeAmount: info.feeAmount, farmerAmount: info.farmerAmount });
});

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
 */
// POST /api/orders
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id, address_id, coupon_code } = req.body;
  const useSorobanEscrow = Boolean(req.body.use_soroban_escrow);
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
    const { rows: addrRows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [address_id, req.user.id]);
    if (!addrRows[0]) return err(res, 400, 'Invalid address_id', 'validation_error');
  }

  const { rows: prodRows } = await db.query(
    'SELECT p.*, u.stellar_public_key as farmer_wallet FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = $1',
    [product_id]
  );
  const product = prodRows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const { rows: buyerRows } = await db.query(
    'SELECT id, name, email, stellar_public_key, stellar_secret_key, referred_by, referral_bonus_sent FROM users WHERE id = $1',
    [req.user.id]
  );
  const buyer = buyerRows[0];

  const weight = req.body.weight ? parseFloat(req.body.weight) : null;
  if (product.pricing_type === 'weight') {
    if (!weight || isNaN(weight) || weight <= 0) return err(res, 400, 'weight is required for weight-based products', 'validation_error');
    if (weight < product.min_weight) return err(res, 400, `weight must be at least ${product.min_weight} ${product.unit}`, 'validation_error');
    if (weight > product.max_weight) return err(res, 400, `weight cannot exceed ${product.max_weight} ${product.unit}`, 'validation_error');
  }

  let subtotal;
  if (product.pricing_type === 'weight') {
    subtotal = Number(product.price) * weight;
  } else {
    const unitPrice = await getEffectiveUnitPrice(product, product_id, quantity);
    subtotal = unitPrice * quantity;
  }
  let discount = 0;
  let appliedCoupon = null;
  if (coupon_code) {
    const { rows: cRows } = await db.query(
      `SELECT * FROM coupons WHERE code = $1 AND farmer_id = $2 AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR used_count < max_uses)`,
      [coupon_code.trim().toUpperCase(), product.farmer_id]
    );
    if (!cRows[0]) return err(res, 400, 'Invalid or expired coupon', 'invalid_coupon');
    appliedCoupon = cRows[0];
    discount = appliedCoupon.discount_type === 'percent'
      ? parseFloat((subtotal * appliedCoupon.discount_value / 100).toFixed(7))
      : Math.min(parseFloat(appliedCoupon.discount_value), subtotal);
  }
  const totalPrice = parseFloat((subtotal - discount).toFixed(7));

  // Parse optional source asset for path payment
  const sourceAsset = req.body.source_asset || null; // { code, issuer } or null for XLM
  const usePathPayment = sourceAsset && sourceAsset.code && sourceAsset.code !== 'XLM';

  // For XLM payments, check balance upfront
  if (!usePathPayment) {
    const balance = await getBalance(buyer.stellar_public_key);
    if (balance < totalPrice + 0.00001)
      return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance', required: (totalPrice + 0.00001).toFixed(7), available: balance.toFixed(7) });
  }

  // Atomic stock decrement
  const { rowCount } = await db.query(
    'UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1',
    [quantity, product_id]
  );
  if (rowCount === 0) return err(res, 400, 'Insufficient stock', 'insufficient_stock');

  const { rows: oRows } = await db.query(
    'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id, weight) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [req.user.id, product_id, quantity, totalPrice, 'pending', address_id || null, weight || null]
  );
  const orderId = oRows[0].id;

  try {
    let txHash;
    let balanceId = null;

    if (useSorobanEscrow) {
      const timeoutDays = parseInt(process.env.SOROBAN_ESCROW_TIMEOUT_DAYS || '14', 10);
      const timeoutUnix = Math.floor(Date.now() / 1000) + timeoutDays * 24 * 60 * 60;
      const soroban = await invokeEscrowContract({
        action: 'deposit',
        senderSecret: buyer.stellar_secret_key,
        orderId,
        buyerPublicKey: buyer.stellar_public_key,
        farmerPublicKey: product.farmer_wallet,
        amount: totalPrice,
        timeoutUnix,
      });
      txHash = soroban.txHash;
      balanceId = `soroban:${orderId}`;
      await db.query(
        'UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3, escrow_status = $4 WHERE id = $5',
        ['paid', txHash, balanceId, 'funded', orderId],
      );
    } else if (product.is_preorder && product.preorder_delivery_date) {
      const unlockAtUnix = parsePreorderUnlockUnix(product.preorder_delivery_date);
      if (!unlockAtUnix) throw new Error('Invalid pre-order delivery date on product');
      const hold = await createPreorderClaimableBalance({
        senderSecret: buyer.stellar_secret_key,
        farmerPublicKey: product.farmer_wallet,
        amount: totalPrice,
        unlockAtUnix,
      });
      txHash = hold.txHash;
      balanceId = hold.balanceId;
      await db.query(
        'UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3, escrow_status = $4 WHERE id = $5',
        ['paid', txHash, balanceId, 'funded', orderId],
      );
    } else if (usePathPayment) {
      const estimate = await getPathPaymentEstimate({
        sourceAssetCode: sourceAsset.code,
        sourceAssetIssuer: sourceAsset.issuer,
        destPublicKey: product.farmer_wallet,
        destAmount: totalPrice,
      });
      const sendMax = (estimate.sourceAmount * 1.01).toFixed(7);
      txHash = await pathPayment({
        senderSecret: buyer.stellar_secret_key,
        sourceAssetCode: sourceAsset.code,
        sourceAssetIssuer: sourceAsset.issuer,
        sendMax,
        receiverPublicKey: product.farmer_wallet,
        destAmount: totalPrice,
        memo: `Order#${orderId}`,
      });
      await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);
    } else {
      txHash = await sendPayment({
        senderSecret: buyer.stellar_secret_key,
        receiverPublicKey: product.farmer_wallet,
        amount: totalPrice,
        memo: `Order#${orderId}`,
      });
      await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);
    }

    const { rows: farmerRows } = await db.query(
      'SELECT id, name, email, stellar_public_key FROM users WHERE id = $1',
      [product.farmer_id],
    );
    const farmer = farmerRows[0];

    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const { rows: refPeek } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [buyer.referred_by]);
      const treasurySecret = process.env.MARKETPLACE_TREASURY_SECRET;
      if (refPeek[0] && treasurySecret) {
        try {
          await sendPayment({
            senderSecret: treasurySecret,
            receiverPublicKey: refPeek[0].stellar_public_key,
            amount: 1.0,
            memo: `Referral Bonus: ${buyer.name}`.slice(0, 28),
          });
          await db.query('UPDATE users SET referral_bonus_sent = 1 WHERE id = $1', [buyer.id]);
        } catch (bonusErr) {
          console.error('[Referral] Failed to send bonus:', bonusErr.message);
        }
      }
    }

    sendOrderEmails({
      order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash },
      product,
      buyer,
      farmer,
    }).catch((mailErr) => console.error('Email notification failed:', mailErr.message));

    if (farmer) {
      sendPushToUser(farmer.id, {
        title: 'New order received',
        body: `${buyer.name} ordered ${quantity} ${product.unit || 'unit'} of ${product.name}`,
        url: '/dashboard',
      }).catch((pushErr) => console.error('Push notification failed:', pushErr.message));
    }

    const { rows: updRows } = await db.query(
      'SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1',
      [product_id],
    );
    const updated = updRows[0];
    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer })
        .catch((lowStockErr) => console.error('Low-stock alert failed:', lowStockErr.message));
    }

    const rewardAmount = Math.floor(totalPrice);
    if (rewardAmount > 0 && buyer.stellar_public_key) {
      mintRewardTokens(buyer.stellar_public_key, rewardAmount)
        .catch((rwErr) => console.error('[Rewards] Failed to mint tokens:', rwErr.message));
    }

    const feeInfo = getPlatformFeeInfo(totalPrice);
    const responseData = {
      success: true,
      orderId,
      status: 'paid',
      txHash,
      totalPrice,
      sorobanEscrow: useSorobanEscrow,
      discount: discount > 0 ? discount : undefined,
      fee: feeInfo.feeAmount > 0 ? { percent: feeInfo.feePercent, amount: feeInfo.feeAmount, farmerAmount: feeInfo.farmerAmount } : undefined,
      preorder: !!product.is_preorder,
      preorderDeliveryDate: product.preorder_delivery_date || null,
      claimableBalanceId: balanceId,
      sourceAsset: usePathPayment ? sourceAsset.code : 'XLM',
    };

    if (appliedCoupon) {
      await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [appliedCoupon.id]);
    }

    if (idempotencyKey) await cacheResponse(idempotencyKey, responseData);
    return res.json(responseData);
  } catch (e) {
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);
    if (e.code === 'no_path') {
      return res.status(402).json({ success: false, message: e.message, code: 'no_path', orderId });
    }
    if (e.code === 'account_not_found') {
      return res.status(402).json({
        success: false,
        message: 'Please fund your wallet before purchasing',
        code: 'unfunded_account',
        orderId,
      });
    }
    const errorData = { success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId };
    if (idempotencyKey) await cacheResponse(idempotencyKey, errorData);
    return res.status(402).json(errorData);
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

  const conditions = ['o.buyer_id = $1'];
  const params = [req.user.id];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push(`o.status = $${params.length + 1}`);
    params.push(status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows: countRows } = await db.query(`SELECT COUNT(*) as count FROM orders o ${where}`, params);
  const total = parseInt(countRows[0].count, 10);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, p.is_preorder, p.preorder_delivery_date, u.name as farmer_name,
            hb.batch_code as harvest_batch_code, hb.harvest_date as harvest_batch_date, hb.notes as harvest_batch_notes,
            a.label as address_label, a.street as address_street, a.city as address_city,
            a.country as address_country, a.postal_code as address_postal_code,
            rr.status as return_status, rr.reason as return_reason, rr.reject_reason, rr.refund_tx_hash
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN harvest_batches hb ON hb.id = p.batch_id
     LEFT JOIN addresses a ON o.address_id = a.id
     LEFT JOIN return_requests rr ON rr.order_id = o.id
     ${where}
     ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
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
router.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1`,
    [req.user.id],
  );
  const total = parseInt(countRows[0].count, 10);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, p.is_preorder, p.preorder_delivery_date, u.name as buyer_name,
            hb.batch_code as harvest_batch_code, hb.harvest_date as harvest_batch_date, hb.notes as harvest_batch_notes,
            a.label as address_label, a.street as address_street, a.city as address_city,
            a.country as address_country, a.postal_code as address_postal_code,
            rr.status as return_status, rr.reason as return_reason, rr.reject_reason, rr.refund_tx_hash
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     LEFT JOIN harvest_batches hb ON hb.id = p.batch_id
     LEFT JOIN addresses a ON o.address_id = a.id
     LEFT JOIN return_requests rr ON rr.order_id = o.id
     WHERE p.farmer_id = $1
     ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset],
  );

  res.json({
    success: true,
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
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

  sendPushToUser(order.buyer_id, {
    title: 'Order status updated',
    body: `Order #${order.id} is now ${status}`,
    url: '/orders',
  }).catch((pushErr) => console.error('Push notification failed:', pushErr.message));

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
    const txHash = String(order.escrow_balance_id || '').startsWith('soroban:')
      ? (await invokeEscrowContract({
          action: 'release',
          senderSecret: farmer.stellar_secret_key,
          orderId: Number(order.id),
        })).txHash
      : await claimBalance({ claimantSecret: farmer.stellar_secret_key, balanceId: order.escrow_balance_id });
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

// POST /api/orders/:id/dispute - buyer or farmer opens Soroban escrow dispute
router.post('/:id/dispute', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (order.buyer_id !== req.user.id && req.user.role !== 'farmer') {
    return err(res, 403, 'Not allowed to dispute this order', 'forbidden');
  }
  if (!String(order.escrow_balance_id || '').startsWith('soroban:')) {
    return err(res, 400, 'Order is not using Soroban escrow', 'invalid_state');
  }

  const { rows: uRows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  if (!uRows[0]) return err(res, 404, 'User not found', 'not_found');

  try {
    const result = await invokeEscrowContract({
      action: 'dispute',
      senderSecret: uRows[0].stellar_secret_key,
      orderId: Number(order.id),
    });
    return res.json({ success: true, txHash: result.txHash });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Dispute failed: ' + e.message, code: 'dispute_failed' });
  }
});

// POST /api/orders/:id/refund - buyer requests Soroban refund after timeout
router.post('/:id/refund', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can request refunds', 'forbidden');

  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 AND buyer_id = $2', [req.params.id, req.user.id]);
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (!String(order.escrow_balance_id || '').startsWith('soroban:')) {
    return err(res, 400, 'Order is not using Soroban escrow', 'invalid_state');
  }

  const { rows: uRows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  if (!uRows[0]) return err(res, 404, 'User not found', 'not_found');

  try {
    const result = await invokeEscrowContract({
      action: 'refund',
      senderSecret: uRows[0].stellar_secret_key,
      orderId: Number(order.id),
    });
    await db.query('UPDATE orders SET escrow_status = $1, stellar_tx_hash = $2 WHERE id = $3', ['refunded', result.txHash, order.id]);
    return res.json({ success: true, txHash: result.txHash });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Refund failed: ' + e.message, code: 'refund_failed' });
  }
});

module.exports = router;
