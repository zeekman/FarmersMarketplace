const router = require('express').Router();
const jwt = require('jsonwebtoken');
const logger = require('../logger');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const QRCode = require('qrcode');
const {
  sendPayment,
  pathPayment,
  getPathPaymentEstimate,
  getBalance,
  getPlatformFeeInfo,
  createClaimableBalance,
  claimBalance,
  createPreorderClaimableBalance,
  mintRewardTokens,
  invokeEscrowContract,
  generatePaymentLink,
  getMemo,
} = require('../utils/stellar');
const {
  sendOrderEmails,
  sendLowStockAlert,
  sendStatusUpdateEmail,
} = require('../utils/mailer');
const { sendPushToUser } = require('../utils/pushNotifications');
const { err } = require('../middleware/error');
const { getCachedResponse, cacheResponse } = require('../utils/idempotency');
const { getTierPrice } = require('./coupons');
const { checkGeoFence, checkCoordinateGeoFence } = require('../utils/geocheck');
const { broadcastStockUpdate } = require('./products');

// XLM per kg per km
const SHIPPING_RATE = 0.001;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parsePreorderUnlockUnix(preorderDeliveryDate) {
  const ms = Date.parse(`${preorderDeliveryDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function isFlashSaleActive(product) {
  if (!product?.flash_sale_price || !product?.flash_sale_ends_at) return false;
  const now = Date.now();
  const endsAt = new Date(product.flash_sale_ends_at).getTime();
  if (endsAt <= now) return false;
  if (product.flash_sale_starts_at) {
    const startsAt = new Date(product.flash_sale_starts_at).getTime();
    if (startsAt > now) return false;
  }
  return true;
}

async function getEffectiveUnitPrice(product, productId, quantity) {
  if (isFlashSaleActive(product)) return Number(product.flash_sale_price);
  return getTierPrice(productId, quantity);
}

// GET /api/orders/fee-preview
router.get('/fee-preview', (req, res) => {
  const amount = parseFloat(req.query.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount is required' });
  const info = getPlatformFeeInfo(amount);
  res.json({ success: true, total: amount, ...info });
});

// GET /api/orders/path-estimate — public DEX routing estimate (no auth required)
router.get('/path-estimate', async (req, res) => {
  const { source_asset, source_asset_issuer, amount_xlm } = req.query;

  if (!source_asset || source_asset === 'XLM') {
    return err(res, 400, 'source_asset must be a non-XLM asset code', 'validation_error');
  }
  const destAmount = parseFloat(amount_xlm);
  if (!amount_xlm || Number.isNaN(destAmount) || destAmount <= 0) {
    return err(res, 400, 'amount_xlm must be a positive number', 'validation_error');
  }

  try {
    const estimate = await getPathPaymentEstimate({
      sourceAssetCode: source_asset,
      sourceAssetIssuer: source_asset_issuer || undefined,
      destAmount,
    });
    const slippagePct = parseFloat(process.env.PATH_PAYMENT_SLIPPAGE_PCT ?? '0.5');
    const sendMax = parseFloat((estimate.sourceAmount * (1 + slippagePct / 100)).toFixed(7));
    return res.json({
      success: true,
      source_asset,
      source_amount: estimate.sourceAmount,
      send_max: sendMax,
      dest_asset: 'XLM',
      dest_amount: destAmount,
      path: estimate.path,
      slippage_pct: slippagePct,
    });
  } catch (e) {
    if (e.code === 'no_path') {
      return res.status(402).json({ success: false, code: 'no_payment_path', message: e.message });
    }
    throw e;
  }
});

// Handle bundle orders atomically
async function handleBundleOrder(req, res, bundle_id, address_id, coupon_code, use_soroban_escrow, idempotencyKey) {
  const { rows: bundleRows } = await db.query(
    `SELECT b.*, u.stellar_public_key as farmer_wallet, u.id as farmer_id
     FROM bundles b JOIN users u ON b.farmer_id = u.id
     WHERE b.id = $1`,
    [bundle_id]
  );
  const bundle = bundleRows[0];
  if (!bundle) return err(res, 404, 'Bundle not found', 'not_found');

  const { rows: bundleItems } = await db.query(
    `SELECT bi.*, p.name as product_name, p.quantity as stock, p.price as product_price,
            p.pricing_type, p.min_weight, p.max_weight, p.unit, p.min_order_quantity,
            p.flash_sale_price, p.flash_sale_starts_at, p.flash_sale_ends_at
     FROM bundle_items bi
     JOIN products p ON bi.product_id = p.id
     WHERE bi.bundle_id = $1`,
    [bundle_id]
  );
  if (bundleItems.length === 0) return err(res, 400, 'Bundle has no products', 'invalid_bundle');

  for (const item of bundleItems) {
    if (item.stock < item.quantity)
      return err(res, 400, `Insufficient stock for "${item.product_name}" in bundle`, 'insufficient_stock');
  }

  const { rows: buyerRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const buyer = buyerRows[0];
  if (!buyer) return err(res, 404, 'Buyer not found', 'not_found');

  const clientIp = req.ip || req.socket?.remoteAddress || '';
  const { allowed: geoAllowed } = await checkGeoFence({ farmer_id: bundle.farmer_id }, buyer, clientIp);
  if (!geoAllowed) return err(res, 403, 'Not available in your region', 'region_restricted');

  let individualTotal = 0;
  for (const item of bundleItems) {
    individualTotal += (isFlashSaleActive(item) ? Number(item.flash_sale_price) : item.product_price) * item.quantity;
  }

  let discount = 0;
  let appliedCoupon = null;
  if (coupon_code) {
    const { rows: cRows } = await db.query(
      `SELECT * FROM coupons WHERE code = $1 AND farmer_id = $2 AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR used_count < max_uses)`,
      [coupon_code.trim().toUpperCase(), bundle.farmer_id]
    );
    if (!cRows[0]) return err(res, 400, 'Invalid or expired coupon', 'invalid_coupon');
    appliedCoupon = cRows[0];
    if (appliedCoupon.max_uses_per_user != null) {
      const { rows: useRows } = await db.query(
        'SELECT COUNT(*) as cnt FROM coupon_uses WHERE coupon_id = $1 AND user_id = $2',
        [appliedCoupon.id, req.user.id]
      );
      if (parseInt(useRows[0].cnt, 10) >= appliedCoupon.max_uses_per_user)
        return err(res, 409, 'Coupon already used', 'coupon_already_used');
    }
    discount = appliedCoupon.discount_type === 'percent'
      ? parseFloat((bundle.price * appliedCoupon.discount_value / 100).toFixed(7))
      : Math.min(parseFloat(appliedCoupon.discount_value), bundle.price);
  }

  const totalPrice = parseFloat((bundle.price - discount).toFixed(7));
  const balance = await getBalance(buyer.stellar_public_key);
  if (balance < totalPrice + 0.00001) {
    return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });
  }

  let orderIds = [];
  try {
    await db.query('BEGIN');
    for (const item of bundleItems) {
      const { rowCount } = await db.query(
        'UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $3',
        [item.quantity, item.product_id, item.quantity]
      );
      if (rowCount === 0) throw new Error(`Insufficient stock for "${item.product_name}"`);
    }
    for (const item of bundleItems) {
      const itemPrice = (item.product_price * item.quantity) / individualTotal * bundle.price;
      const { rows: orderRows } = await db.query(
        `INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id, bundle_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user.id, item.product_id, item.quantity, itemPrice, 'pending', address_id || null, bundle_id]
      );
      orderIds.push(orderRows[0].id);
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    return err(res, 400, e.message || 'Failed to process bundle order', 'bundle_order_failed');
  }

  try {
    const txHash = await sendPayment({
      senderSecret: buyer.stellar_secret_key,
      receiverPublicKey: bundle.farmer_wallet,
      amount: totalPrice,
      memo: `Bundle#${bundle_id}`,
    });
    for (const orderId of orderIds) {
      await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);
    }
    if (appliedCoupon) {
      await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [appliedCoupon.id]);
      await db.query('INSERT INTO coupon_uses (coupon_id, user_id) VALUES ($1, $2)', [appliedCoupon.id, req.user.id]);
    }
    const savings = parseFloat((individualTotal - totalPrice).toFixed(7));
    const responseData = {
      success: true,
      orderIds,
      bundleId: bundle_id,
      status: 'paid',
      txHash,
      totalPrice,
      bundlePrice: bundle.price,
      individualTotal,
      savings: savings > 0 ? savings : undefined,
      discount: discount > 0 ? discount : undefined,
      coupon: appliedCoupon ? { code: appliedCoupon.code, discount_type: appliedCoupon.discount_type } : undefined,
    };
    if (idempotencyKey) await cacheResponse(idempotencyKey, responseData);
    return res.json(responseData);
  } catch (e) {
    await db.query('BEGIN');
    for (const orderId of orderIds) {
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    }
    for (const item of bundleItems) {
      await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [item.quantity, item.product_id]);
    }
    await db.query('COMMIT');
    const errorData = { success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderIds };
    if (idempotencyKey) await cacheResponse(idempotencyKey, errorData);
    return res.status(402).json(errorData);
  }
}

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Place and pay for an order (buyer only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', auth, validate.order, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can place orders', 'forbidden');

  const { product_id, quantity, address_id, coupon_code, use_soroban_escrow, custom_price, weight, source_asset, bundle_id, source_asset_code, source_asset_issuer, max_source_amount } = req.body;

  // Resolve path-payment asset from flat fields (preferred) or legacy nested object
  const _sourceAssetCode = source_asset_code || (source_asset && source_asset.code);
  const _sourceAssetIssuer = source_asset_issuer || (source_asset && source_asset.issuer);
  const idempotencyKey = req.headers['x-idempotency-key'];

  if (idempotencyKey) {
    const cached = getCachedResponse(idempotencyKey);
    if (cached) return res.status(cached.success ? 200 : 402).json(cached);
  }

  if (address_id) {
    const { rows: addrRows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [address_id, req.user.id]);
    if (!addrRows[0]) return err(res, 400, 'Invalid address_id', 'validation_error');
  }

  if (bundle_id) {
    return await handleBundleOrder(req, res, bundle_id, address_id, coupon_code, use_soroban_escrow, idempotencyKey);
  }

  const { rows: prodRows } = await db.query(
    `SELECT p.*, u.stellar_public_key as farmer_wallet, u.id as farmer_id
     FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = $1`,
    [product_id]
  );
  const product = prodRows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  // Flash sale timing — server time is the source of truth
  if (product.flash_sale_price && product.flash_sale_ends_at) {
    const now = Date.now();
    if (product.flash_sale_starts_at && new Date(product.flash_sale_starts_at).getTime() > now)
      return err(res, 422, 'Flash sale has not started yet', 'flash_sale_not_started');
    if (new Date(product.flash_sale_ends_at).getTime() <= now)
      return err(res, 422, 'Flash sale has ended', 'flash_sale_ended');
  }

  const { rows: buyerRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const buyer = buyerRows[0];

  const clientIp = req.ip || req.socket?.remoteAddress || '';
  const { allowed: geoAllowed } = await checkGeoFence(product, buyer, clientIp);
  if (!geoAllowed) return err(res, 403, 'Not available in your region', 'region_restricted');

  const { delivery_lat, delivery_lng } = req.body;
  const coordFence = checkCoordinateGeoFence(product, delivery_lat, delivery_lng);
  if (!coordFence.allowed)
    return err(res, 403, 'Delivery location is outside the permitted area for this product', 'outside_delivery_area');

  const parsedWeight = weight != null ? parseFloat(weight) : null;
  if (product.pricing_type === 'weight') {
    if (!parsedWeight || isNaN(parsedWeight) || parsedWeight <= 0)
      return err(res, 400, 'weight is required for weight-based products', 'validation_error');
    if (parsedWeight < product.min_weight)
      return err(res, 400, `weight must be at least ${product.min_weight} ${product.unit}`, 'validation_error');
    if (parsedWeight > product.max_weight)
      return err(res, 400, `weight cannot exceed ${product.max_weight} ${product.unit}`, 'validation_error');
  }

  const moq = product.min_order_quantity || 1;
  if (quantity < moq) return err(res, 400, `Minimum order is ${moq} units`, 'below_moq');

  // Determine unit price based on pricing model
  let unitPrice;
  if (product.pricing_model === 'pwyw') {
    if (!custom_price || custom_price < product.min_price)
      return err(res, 422, `Offered price is below the minimum of ${product.min_price} XLM`, 'below_min_price');
    unitPrice = parseFloat(custom_price);
  } else if (product.pricing_model === 'donation') {
    if (!custom_price || custom_price <= 0)
      return err(res, 400, 'Donation amount must be positive', 'validation_error');
    unitPrice = parseFloat(custom_price);
  } else {
    unitPrice = await getEffectiveUnitPrice(product, product_id, quantity);
  }

  const subtotal = product.pricing_type === 'weight'
    ? unitPrice * parsedWeight
    : unitPrice * quantity;

  // Coupon discount
  let discount = 0;
  let appliedCoupon = null;
  if (coupon_code) {
    const { rows: cRows } = await db.query(
      `SELECT * FROM coupons WHERE code = $1 AND farmer_id = $2 AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR used_count < max_uses)`,
      [coupon_code.trim().toUpperCase(), product.farmer_id]
    );
    if (!cRows[0]) return err(res, 400, 'Invalid or expired coupon', 'invalid_coupon');
    appliedCoupon = cRows[0];
    if (appliedCoupon.max_uses_per_user != null) {
      const { rows: useRows } = await db.query(
        'SELECT COUNT(*) as cnt FROM coupon_uses WHERE coupon_id = $1 AND user_id = $2',
        [appliedCoupon.id, req.user.id]
      );
      if (parseInt(useRows[0].cnt, 10) >= appliedCoupon.max_uses_per_user)
        return err(res, 409, 'Coupon already used', 'coupon_already_used');
    }
    discount = appliedCoupon.discount_type === 'percent'
      ? parseFloat((subtotal * appliedCoupon.discount_value / 100).toFixed(7))
      : Math.min(parseFloat(appliedCoupon.discount_value), subtotal);
  }

  // Bundle discount (multi-product from same farmer)
  let bundleDiscount = 0;
  let appliedBundleDiscount = null;
  try {
    const { rows: pendingItems } = await db.query(
      `SELECT COUNT(DISTINCT product_id) as cnt FROM orders
       WHERE buyer_id = $1 AND status = 'pending'
         AND product_id IN (SELECT id FROM products WHERE farmer_id = $2)`,
      [req.user.id, product.farmer_id]
    );
    const distinctProducts = parseInt(pendingItems[0]?.cnt || 0, 10) + 1;
    if (distinctProducts >= 2) {
      const { rows: tiers } = await db.query(
        `SELECT * FROM bundle_discounts WHERE farmer_id = $1 AND min_products <= $2
         ORDER BY min_products DESC LIMIT 1`,
        [product.farmer_id, distinctProducts]
      );
      if (tiers[0]) {
        appliedBundleDiscount = tiers[0];
        bundleDiscount = parseFloat(((subtotal - discount) * tiers[0].discount_percent / 100).toFixed(7));
      }
    }
  } catch {
    // bundle_discounts table may not exist yet — skip silently
  }

  const totalPrice = parseFloat((subtotal - discount - bundleDiscount).toFixed(7));

  const usePathPayment = !!(_sourceAssetCode && _sourceAssetCode !== 'XLM');

  // Path payment pre-flight — verify the DEX path and compute sendMax BEFORE creating the
  // order so that the order is never persisted when no valid path exists.
  let pathSendMax = null;
  if (usePathPayment) {
    const slippagePct = parseFloat(process.env.PATH_PAYMENT_SLIPPAGE_PCT ?? '0.5');
    let estimate;
    try {
      estimate = await getPathPaymentEstimate({
        sourceAssetCode: _sourceAssetCode,
        sourceAssetIssuer: _sourceAssetIssuer,
        destAmount: totalPrice,
      });
    } catch {
      return res.status(402).json({ success: false, code: 'no_payment_path', message: 'No payment path found' });
    }
    const slippageAdjusted = parseFloat((estimate.sourceAmount * (1 + slippagePct / 100)).toFixed(7));
    if (max_source_amount != null && parseFloat(max_source_amount) < estimate.sourceAmount) {
      return res.status(402).json({ success: false, code: 'no_payment_path', message: 'max_source_amount is below the current path rate' });
    }
    pathSendMax = max_source_amount != null
      ? parseFloat(parseFloat(max_source_amount).toFixed(7))
      : slippageAdjusted;
  } else {
    // Standard XLM balance check (skipped for path payments)
    const balance = await getBalance(buyer.stellar_public_key);
    if (balance < totalPrice + 0.00001)
      return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });
  }

  const { rows: orderRows } = await db.query(
    `INSERT INTO orders (buyer_id, product_id, quantity, total_price, custom_price, status, address_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user.id, product_id, quantity, totalPrice, custom_price || null, 'pending', address_id || null]
  );
  const orderId = orderRows[0].id;

  // SEP-0007 wallet flow — return payment link without processing
  if (req.body.payment_method === 'sep7') {
    if (appliedCoupon) {
      await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [appliedCoupon.id]);
      await db.query('INSERT INTO coupon_uses (coupon_id, user_id) VALUES ($1, $2)', [appliedCoupon.id, req.user.id]);
    }
    const responseData = { success: true, orderId, status: 'pending', totalPrice, message: 'Order created for SEP-0007 payment' };
    if (idempotencyKey) cacheResponse(idempotencyKey, responseData);
    return res.json(responseData);
  }

  // Payment processing
  try {
    let txHash;
    let balanceId = null;

    if (use_soroban_escrow) {
      const timeoutDays = parseInt(process.env.SOROBAN_ESCROW_TIMEOUT_DAYS || '14', 10);
      const timeoutUnix = Math.floor(Date.now() / 1000) + timeoutDays * 24 * 60 * 60;
      const result = await invokeEscrowContract({
        action: 'deposit',
        senderSecret: buyer.stellar_secret_key,
        orderId,
        buyerPublicKey: buyer.stellar_public_key,
        farmerPublicKey: product.farmer_wallet,
        amount: totalPrice,
        timeoutUnix,
      });
      txHash = result.txHash;
      balanceId = `soroban:${orderId}`;
      await db.query(
        'UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3, escrow_status = $4 WHERE id = $5',
        ['paid', txHash, balanceId, 'funded', orderId]
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
        ['paid', txHash, balanceId, 'funded', orderId]
      );
    } else if (usePathPayment) {
      txHash = await pathPayment({
        senderSecret: buyer.stellar_secret_key,
        sourceAssetCode: _sourceAssetCode,
        sourceAssetIssuer: _sourceAssetIssuer,
        sendMax: pathSendMax,
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
      [product.farmer_id]
    );
    const farmer = farmerRows[0];

    // One-time referral bonus
    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const { rows: refPeek } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [buyer.referred_by]);
      const treasurySecret = process.env.MARKETPLACE_TREASURY_SECRET;
      if (refPeek[0] && treasurySecret) {
        try {
          await sendPayment({ senderSecret: treasurySecret, receiverPublicKey: refPeek[0].stellar_public_key, amount: 1.0, memo: `Referral Bonus: ${buyer.name}`.slice(0, 28) });
          await db.query('UPDATE users SET referral_bonus_sent = 1 WHERE id = $1', [buyer.id]);
        } catch (bonusErr) {
          logger.error('[Referral] Failed to send bonus:', { error: bonusErr.message });
        }
      }
    }

    if (appliedCoupon) {
      await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [appliedCoupon.id]);
      await db.query('INSERT INTO coupon_uses (coupon_id, user_id) VALUES ($1, $2)', [appliedCoupon.id, req.user.id]);
    }

    sendOrderEmails({ order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash }, product, buyer, farmer })
      .catch((mailErr) => logger.error('Email notification failed:', { error: mailErr.message }));

    if (farmer) {
      sendPushToUser(farmer.id, { title: 'New order received', body: `${buyer.name} ordered ${quantity} ${product.unit || 'unit'} of ${product.name}`, url: '/dashboard' })
        .catch((pushErr) => logger.error('Push notification failed:', { error: pushErr.message }));
    }

    const { rows: updRows } = await db.query(
      'SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1',
      [product_id]
    );
    const updated = updRows[0];
    if (updated && updated.low_stock_threshold > 0 && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer })
        .catch((e) => logger.error('Low-stock alert failed:', { error: e.message }));
    }
    if (updated) broadcastStockUpdate(product_id, updated.quantity);

    const rewardAmount = Math.floor(totalPrice);
    if (rewardAmount > 0 && buyer.stellar_public_key) {
      mintRewardTokens(buyer.stellar_public_key, rewardAmount)
        .catch((e) => logger.error('[Rewards] Failed to mint tokens:', { error: e.message }));
    }

    const feeInfo = getPlatformFeeInfo(totalPrice);
    const responseData = {
      success: true,
      orderId,
      status: 'paid',
      txHash,
      totalPrice,
      quantity,
      sorobanEscrow: !!use_soroban_escrow,
      discount: discount > 0 ? discount : undefined,
      bundleDiscount: bundleDiscount > 0 ? { amount: bundleDiscount, percent: appliedBundleDiscount.discount_percent, minProducts: appliedBundleDiscount.min_products } : undefined,
      fee: feeInfo.feeAmount > 0 ? { percent: feeInfo.feePercent, amount: feeInfo.feeAmount, farmerAmount: feeInfo.farmerAmount } : undefined,
      preorder: !!product.is_preorder,
      preorderDeliveryDate: product.preorder_delivery_date || null,
      claimableBalanceId: balanceId,
      sourceAsset: usePathPayment ? _sourceAssetCode : 'XLM',
    };
    if (idempotencyKey) await cacheResponse(idempotencyKey, responseData);
    return res.json(responseData);
  } catch (e) {
    if (usePathPayment) {
      // Path payment orders must not be persisted on failure — delete the pending row
      await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
      await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);
      return res.status(402).json({ success: false, code: 'no_payment_path', message: e.message || 'Path payment could not be completed' });
    }
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);
    if (e.code === 'account_not_found')
      return res.status(402).json({ success: false, message: 'Please fund your wallet before purchasing', code: 'unfunded_account', orderId });
    const errorData = { success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId };
    if (idempotencyKey) await cacheResponse(idempotencyKey, errorData);
    return res.status(402).json(errorData);
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
  if (status) { conditions.push(`o.status = $${params.length + 1}`); params.push(status); }

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
    [...params, limit, offset]
  );

  await Promise.all(data.map(async (o) => {
    if (o.status !== 'paid' || !o.stellar_tx_hash || o.stellar_memo) return;
    const memo = await getMemo(o.stellar_tx_hash);
    if (memo) {
      o.stellar_memo = memo;
      db.query('UPDATE orders SET stellar_memo = $1 WHERE id = $2', [memo, o.id]).catch(() => {});
    }
  }));

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

/**
 * @swagger
 * /api/orders/sales:
 *   get:
 *     summary: Get farmer's incoming sales
 *     tags: [Orders]
 */
router.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1`,
    [req.user.id]
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
    [req.user.id, limit, offset]
  );

  await Promise.all(data.map(async (o) => {
    if (o.status !== 'paid' || !o.stellar_tx_hash || o.stellar_memo) return;
    const memo = await getMemo(o.stellar_tx_hash);
    if (memo) {
      o.stellar_memo = memo;
      db.query('UPDATE orders SET stellar_memo = $1 WHERE id = $2', [memo, o.id]).catch(() => {});
    }
  }));

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', auth, validate.updateOrderStatus, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { status } = req.body;
  const { rows } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, u.name as buyer_name, u.email as buyer_email, u.stellar_public_key as buyer_stellar_address
     FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON o.buyer_id = u.id
     WHERE o.id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found or not yours', 'not_found');

  await db.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);

  if (status === 'completed' && order.buyer_stellar_address) {
    const rewardAmount = parseInt(process.env.REWARD_TOKENS_PER_ORDER || '100', 10);
    if (rewardAmount > 0) {
      mintRewardTokens(order.buyer_stellar_address, rewardAmount)
        .catch((e) => logger.error(`Failed to mint reward tokens for order ${order.id}:`, { error: e.message }));
    }
  }

  broadcastOrderUpdate(order.buyer_id, order.id, status);

  sendStatusUpdateEmail({
    order,
    product: { name: order.product_name, unit: order.unit },
    buyer: { name: order.buyer_name, email: order.buyer_email },
    newStatus: status,
  }).catch((e) => logger.error('Status email failed:', { error: e.message }));

  sendPushToUser(order.buyer_id, { title: 'Order status updated', body: `Order #${order.id} is now ${status}`, url: '/orders' })
    .catch((e) => logger.error('Push notification failed:', { error: e.message }));

  res.json({ success: true, message: 'Order status updated' });
});

// POST /api/orders/:id/escrow — fund escrow for an existing pending order
router.post('/:id/escrow', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can fund escrow', 'forbidden');

  const { rows } = await db.query(
    `SELECT o.*, u.stellar_public_key as farmer_wallet
     FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON p.farmer_id = u.id
     WHERE o.id = $1 AND o.buyer_id = $2`,
    [req.params.id, req.user.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (order.escrow_status === 'funded') return err(res, 409, 'Escrow already funded', 'already_funded');

  const { rows: buyerRows } = await db.query(
    'SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1',
    [req.user.id]
  );
  const buyer = buyerRows[0];

  try {
    const timeoutDays = parseInt(process.env.SOROBAN_ESCROW_TIMEOUT_DAYS || '14', 10);
    const timeoutUnix = Math.floor(Date.now() / 1000) + timeoutDays * 24 * 60 * 60;
    const result = await invokeEscrowContract({
      action: 'deposit',
      senderSecret: buyer.stellar_secret_key,
      orderId: Number(order.id),
      buyerPublicKey: buyer.stellar_public_key,
      farmerPublicKey: order.farmer_wallet,
      amount: order.total_price,
      timeoutUnix,
    });
    await db.query(
      'UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3, escrow_status = $4 WHERE id = $5',
      ['paid', result.txHash, `soroban:${order.id}`, 'funded', order.id]
    );
    return res.json({ success: true, txHash: result.txHash });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Escrow funding failed: ' + e.message, code: 'escrow_failed' });
  }
});

// POST /api/orders/:id/dispute
router.post('/:id/dispute', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  const order = rows[0];
  if (!order || (order.buyer_id !== req.user.id && req.user.role !== 'farmer'))
    return err(res, 403, 'Forbidden', 'forbidden');
  if (!String(order.escrow_balance_id || '').startsWith('soroban:'))
    return err(res, 400, 'Not a Soroban order', 'invalid_state');

  const { rows: uRows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const result = await invokeEscrowContract({ action: 'dispute', senderSecret: uRows[0].stellar_secret_key, orderId: Number(order.id) });
    return res.json({ success: true, txHash: result.txHash });
  } catch (e) {
    return res.status(402).json({ success: false, message: e.message });
  }
});

// POST /api/orders/:id/refund
router.post('/:id/refund', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Buyers only', 'forbidden');
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 AND buyer_id = $2', [req.params.id, req.user.id]);
  const order = rows[0];
  if (!order || !String(order.escrow_balance_id || '').startsWith('soroban:'))
    return err(res, 400, 'Not a Soroban order', 'invalid_state');

  const { rows: uRows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const result = await invokeEscrowContract({ action: 'refund', senderSecret: uRows[0].stellar_secret_key, orderId: Number(order.id) });
    await db.query('UPDATE orders SET escrow_status = $1, stellar_tx_hash = $2 WHERE id = $3', ['refunded', result.txHash, order.id]);
    return res.json({ success: true, txHash: result.txHash });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Refund failed: ' + e.message, code: 'refund_failed' });
  }
});

// GET /api/orders/:id/payment-link — returns a SEP-0007 URI for the order
router.get('/:id/payment-link', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT o.*, p.name AS product_name, u.stellar_public_key AS farmer_public_key
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     WHERE o.id = $1`,
    [req.params.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (order.buyer_id !== req.user.id && req.user.role !== 'admin')
    return err(res, 403, 'Forbidden', 'forbidden');

  const link = generatePaymentLink({
    destination: order.farmer_public_key,
    amount: String(order.total_price),
    assetCode: 'XLM',
    assetIssuer: '',
    memo: `order:${order.id}`,
  });
  res.json({ success: true, paymentLink: link, orderId: order.id });
});

// SSE clients map: userId -> Set of response objects
const orderClients = new Map();

function broadcastOrderUpdate(userId, orderId, status) {
  const clients = orderClients.get(userId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify({ id: orderId, status })}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { /* ignore */ }
  }
}

// GET /api/orders/stream — SSE for real-time order status (auth via ?token= query param)
router.get('/stream', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });
  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!orderClients.has(user.id)) orderClients.set(user.id, new Set());
  orderClients.get(user.id).add(res);

  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = orderClients.get(user.id);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) orderClients.delete(user.id);
    }
  });
});

module.exports = router;
module.exports.broadcastOrderUpdate = broadcastOrderUpdate;
