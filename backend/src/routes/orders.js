const router = require('express').Router();
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

    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3 WHERE id = $4', ['paid', txHash, balanceId, orderId]);

    // Cleanup and notifications
    if (appliedCoupon) {
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

  res.json({ success: true, data, total, page, limit });
});

module.exports = router;
