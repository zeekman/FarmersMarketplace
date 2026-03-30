const router = require('express').Router();
const logger = require('../logger');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  sendPayment,
  getBalance,
  getPlatformFeeInfo,
  createClaimableBalance,
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
 * /api/orders:
 *   post:
 *     summary: Place and pay for an order (buyer only)
 */
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
    if (cached) return res.json(cached);
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

  const unitPrice = await getEffectiveUnitPrice(product, product_id, quantity);
  const subtotal = unitPrice * quantity;
  let discount = 0;
  let appliedCoupon = null;

  if (coupon_code) {
    const { coupon, error, code: errCode } = resolveCoupon(coupon_code, product.farmer_id);
    if (!error) {
       discount = calcDiscount(coupon, subtotal);
       appliedCoupon = coupon;
    }
  }

  const totalPrice = parseFloat((subtotal - discount).toFixed(7));
  const balance = await getBalance(buyer.stellar_public_key);
  const required = totalPrice + 0.00001;
  if (balance < required) {
    return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });
  }

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

    if (useSorobanEscrow) {
      const timeoutDays = parseInt(process.env.SOROBAN_ESCROW_TIMEOUT_DAYS || '14', 10);
      txHash = await invokeEscrowContract({
        action: 'deposit', senderSecret: buyer.stellar_secret_key, orderId, buyerPublicKey: buyer.stellar_public_key, farmerPublicKey: product.farmer_wallet, amount: totalPrice,
        timeoutUnix: Math.floor(Date.now()/1000) + timeoutDays * 86400
      });
      balanceId = `soroban:${orderId}`;
    } else {
      txHash = await sendPayment({ senderSecret: buyer.stellar_secret_key, receiverPublicKey: product.farmer_wallet, amount: totalPrice, memo: `Order#${orderId}` });
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
          await db.query('UPDATE users SET referral_bonus_sent = 1 WHERE id = $1', [buyer.id]);
        } catch (bonusErr) {
          logger.error('[Referral] Failed to send bonus:', { error: bonusErr.message });
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
    }).catch((mailErr) => logger.error('Email notification failed:', { error: mailErr.message }));

    sendPushToUser(farmer.id, {
      title: 'New order received',
      body: `${buyer.name} ordered ${quantity} ${product.unit || 'unit'} of ${product.name}`,
      url: '/dashboard',
    }).catch((pushErr) => logger.error('Push notification failed:', { error: pushErr.message }));

    const updated = db.prepare(
      'SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = ?'
    ).get(product_id);
    const { rows: updRows } = await db.query('SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1', [product_id]);
    const updated = updRows[0];

    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer })
        .catch((lowStockErr) => logger.error('Low-stock alert failed:', { error: lowStockErr.message }));
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
    };
    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3 WHERE id = $4', ['paid', txHash, balanceId, orderId]);

    // Cleanup and notifications
    if (appliedCoupon) {
      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(appliedCoupon.id);
    }

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

    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);

    // Referral bonus
    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const { rows: refRows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [buyer.referred_by]);
      const treasurySecret = process.env.MARKETPLACE_TREASURY_SECRET;
      if (refRows[0] && treasurySecret) {
        sendPayment({ senderSecret: treasurySecret, receiverPublicKey: refRows[0].stellar_public_key, amount: 1.0, memo: `Referral Bonus: ${buyer.name}`.slice(0, 28) })
          .then(() => db.query('UPDATE users SET referral_bonus_sent = 1 WHERE id = $1', [buyer.id]))
          .catch(e => logger.error('[Referral] Failed to send bonus:', { error: e.message }));
      }
    }

    const { rows: fRows } = await db.query('SELECT id, name, email, stellar_public_key FROM users WHERE id = $1', [product.farmer_id]);
    sendOrderEmails({ order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash }, product, buyer, farmer: fRows[0] })
      .catch(e => logger.error('Email notification failed:', { error: e.message }));

    // Mint reward tokens (1 token per 1 XLM spent)
    const rewardAmount = Math.floor(totalPrice);
    if (rewardAmount > 0 && buyer.stellar_public_key) {
      mintRewardTokens(buyer.stellar_public_key, rewardAmount)
        .catch(e => logger.error('[Rewards] Failed to mint tokens:', { error: e.message }));
    }

    // Low-stock check
    const { rows: updRows } = await db.query('SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1', [product_id]);
    const updated = updRows[0];
    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer: fRows[0] })
        .catch(e => logger.error('Low-stock alert failed:', { error: e.message }));
    }
       await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [appliedCoupon.id]);
    }

    const { rows: fRows } = await db.query('SELECT id, name, email, stellar_public_key FROM users WHERE id = $1', [product.farmer_id]);
    const farmer = fRows[0];

    sendOrderEmails({ order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash }, product, buyer, farmer })
      .catch(e => console.error('Email failed:', e.message));

    const responseData = { success: true, orderId, status: 'paid', txHash, totalPrice };
    if (idempotencyKey) cacheResponse(idempotencyKey, responseData);
    res.json(responseData);

  } catch (e) {
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);
    res.status(402).json({ success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId });
  }
});

// GET /api/orders
router.get('/', auth, async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const conditions = ['o.buyer_id = $1'];
  const params = [req.user.id];
  if (status) {
    conditions.push(`o.status = $${params.length + 1}`);
    params.push(status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows: countRows } = await db.query(`SELECT COUNT(*) as count FROM orders o ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     ${where}
     ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  res.json({ success: true, data, total, page, limit });
});

// GET /api/orders/sales
router.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    'SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1',
    [req.user.id]
  );
  const total = parseInt(countRows[0].count);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, u.name as buyer_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
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
  }).catch((e) => logger.error('Status email failed:', { error: e.message }));

  sendPushToUser(order.buyer_id, {
    title: 'Order status updated',
    body: `Order #${order.id} is now ${status}`,
    url: '/orders',
  }).catch((pushErr) => logger.error('Push notification failed:', { error: pushErr.message }));

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
  res.json({ success: true, data, total, page, limit });
});

module.exports = router;
