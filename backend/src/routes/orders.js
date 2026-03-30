const router = require('express').Router();
const logger = require('../logger');
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
  claimBalance,
  mintRewardTokens,
  invokeEscrowContract,
  pathPayment,
  getPathPaymentEstimate,
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
    `SELECT min_quantity, price_per_unit FROM price_tiers WHERE product_id = $1 ORDER BY min_quantity DESC`,
    [productId]
  );
  for (const tier of tiers) {
    if (quantity >= tier.min_quantity) return tier.price_per_unit;
  }
  const { rows: productRows } = await db.query('SELECT price FROM products WHERE id = $1', [productId]);
  return productRows[0]?.price || 0;
}

function isFlashSaleActive(product) {
  if (!product?.flash_sale_price || !product?.flash_sale_ends_at) return false;
  return new Date(product.flash_sale_ends_at).getTime() > Date.now();
}

async function getEffectiveUnitPrice(product, productId, quantity) {
  if (isFlashSaleActive(product)) return Number(product.flash_sale_price);
  return getTierPrice(productId, quantity);
}

// GET /api/orders/fee-preview
// GET /api/orders/fee-preview?amount=X — returns fee breakdown for a given amount
router.get('/fee-preview', (req, res) => {
  const amount = parseFloat(req.query.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount is required' });
  const info = getPlatformFeeInfo(amount);
  res.json({ success: true, total: amount, ...info });
});

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order placement and management
 */

// POST /api/orders
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

  const { product_id, quantity, address_id, coupon_code, use_soroban_escrow, custom_price, weight, source_asset } = req.body;
  const idempotencyKey = req.headers['x-idempotency-key'];

  if (idempotencyKey) {
    const cached = getCachedResponse(idempotencyKey);
    if (cached) return res.status(cached.success ? 200 : 402).json(cached);
    if (cached) return res.json(cached);
  }

  if (address_id) {
    const { rows: addrRows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [address_id, req.user.id]);
    if (!addrRows[0]) return err(res, 400, 'Invalid address_id', 'validation_error');
  }

  // 1. Fetch Product & Buyer
  const { rows: prodRows } = await db.query(
    `SELECT p.*, u.stellar_public_key as farmer_wallet, u.id as farmer_id FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = $1`,
    [product_id]
  );
  const product = prodRows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const { rows: buyerRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
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
  // 2. Validate Pricing & Calculate Total
  let unitPrice = 0;
  if (product.pricing_model === 'pwyw') {
    if (!custom_price || custom_price < product.min_price) {
      return err(res, 400, `Minimum price is ${product.min_price} XLM`, 'validation_error');
    }
    unitPrice = parseFloat(custom_price);
  } else if (product.pricing_model === 'donation') {
    if (!custom_price || custom_price <= 0) {
      return err(res, 400, 'Donation amount must be positive', 'validation_error');
    }
    unitPrice = parseFloat(custom_price);
  } else if (product.pricing_type === 'weight') {
    if (!weight) return err(res, 400, 'Weight is required', 'validation_error');
    unitPrice = product.price; // Price is per unit of weight
  } else {
    unitPrice = await getEffectiveUnitPrice(product, product_id, quantity);
  }

  const subtotal = product.pricing_type === 'weight' ? unitPrice * weight : unitPrice * quantity;
  let discount = 0;
  let appliedCoupon = null;

  if (coupon_code && product.pricing_model === 'fixed') { // Coupons usually apply to fixed price
    const result = await db.query('SELECT * FROM coupons WHERE code = $1 AND farmer_id = $2', [coupon_code, product.farmer_id]);
    if (result.rows[0]) {
      appliedCoupon = result.rows[0];
      discount = calcDiscount(appliedCoupon, subtotal);
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

  // 3. Balance Check
  const usePathPayment = source_asset && source_asset.code && source_asset.code !== 'XLM';
  if (!usePathPayment) {
    const balance = await getBalance(buyer.stellar_public_key);
    if (balance < totalPrice + 0.00001) return res.status(402).json({ success: false, message: 'Insufficient balance', code: 'insufficient_balance' });
  const balance = await getBalance(buyer.stellar_public_key);
  const required = totalPrice + 0.00001;
  if (balance < required) {
    return res.status(402).json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });
  }

  // 4. Atomic Stock Check & Initial Order Save
  const { rowCount } = await db.query('UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $3', [quantity, product_id, quantity]);
  if (rowCount === 0) return err(res, 400, 'Insufficient stock', 'insufficient_stock');

  const { rows: orderRows } = await db.query(
    `INSERT INTO orders (buyer_id, product_id, quantity, total_price, custom_price, status, address_id) 
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user.id, product_id, quantity, totalPrice, custom_price || null, 'pending', address_id || null]
  const { rows: oRows } = await db.query(
    'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, address_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.user.id, product_id, quantity, totalPrice, 'pending', address_id || null]
  );
  const orderId = orderRows[0].id;

  // 5. Payment Processing
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
      await db.query('UPDATE orders SET status=$1, stellar_tx_hash=$2, escrow_balance_id=$3, escrow_status=$4 WHERE id=$5', ['paid', txHash, balanceId, 'funded', orderId]);

    } else if (product.is_preorder && product.preorder_delivery_date) {
      const { txHash: hTx, balanceId: bId } = await createPreorderClaimableBalance({
        senderSecret: buyer.stellar_secret_key,
        farmerPublicKey: product.farmer_wallet,
        amount: totalPrice,
        unlockAtUnix: parsePreorderUnlockUnix(product.preorder_delivery_date),
      });
      txHash = hTx;
      balanceId = bId;
      await db.query('UPDATE orders SET status=$1, stellar_tx_hash=$2, escrow_balance_id=$3, escrow_status=$4 WHERE id=$5', ['paid', txHash, balanceId, 'funded', orderId]);

    } else if (usePathPayment) {
      const estimate = await getPathPaymentEstimate({ sourceAssetCode: source_asset.code, sourceAssetIssuer: source_asset.issuer, destPublicKey: product.farmer_wallet, destAmount: totalPrice });
      txHash = await pathPayment({
        senderSecret: buyer.stellar_secret_key,
        sourceAssetCode: source_asset.code,
        sourceAssetIssuer: source_asset.issuer,
        sendMax: (estimate.sourceAmount * 1.05).toFixed(7),
        receiverPublicKey: product.farmer_wallet,
        destAmount: totalPrice,
        memo: `Order#${orderId}`
      });
      await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);
      await db.query('UPDATE orders SET status=$1, stellar_tx_hash=$2 WHERE id=$3', ['paid', txHash, orderId]);

    } else {
      txHash = await sendPayment({ senderSecret: buyer.stellar_secret_key, receiverPublicKey: product.farmer_wallet, amount: totalPrice, memo: `Order#${orderId}` });
      await db.query('UPDATE orders SET status=$1, stellar_tx_hash=$2 WHERE id=$3', ['paid', txHash, orderId]);
      txHash = await invokeEscrowContract({
        action: 'deposit', senderSecret: buyer.stellar_secret_key, orderId, buyerPublicKey: buyer.stellar_public_key, farmerPublicKey: product.farmer_wallet, amount: totalPrice,
        timeoutUnix: Math.floor(Date.now()/1000) + timeoutDays * 86400
      });
      await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);
    }

    const { rows: farmerRows } = await db.query(
      'SELECT id, name, email, stellar_public_key FROM users WHERE id = $1',
      [product.farmer_id],
    );
    const farmer = farmerRows[0];
      balanceId = `soroban:${orderId}`;
    } else {
      txHash = await sendPayment({ senderSecret: buyer.stellar_secret_key, receiverPublicKey: product.farmer_wallet, amount: totalPrice, memo: `Order#${orderId}` });
    }

    // 6. Post-Payment Actions
    const { rows: fRows } = await db.query('SELECT * FROM users WHERE id = $1', [product.farmer_id]);
    const farmer = fRows[0];

    // Referral bonus (one-time)
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
          logger.error('[Referral] Failed to send bonus:', { error: bonusErr.message });
        }
      }
    }

    sendOrderEmails({
      order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash },
      product,
      buyer,
      farmer,
    }).catch((mailErr) => logger.error('Email notification failed:', { error: mailErr.message }));

    if (farmer) {
      sendPushToUser(farmer.id, {
        title: 'New order received',
        body: `${buyer.name} ordered ${quantity} ${product.unit || 'unit'} of ${product.name}`,
        url: '/dashboard',
      }).catch((pushErr) => console.error('Push notification failed:', pushErr.message));
    }
    sendPushToUser(farmer.id, {
      title: 'New order received',
      body: `${buyer.name} ordered ${quantity} ${product.unit || 'unit'} of ${product.name}`,
      url: '/dashboard',
    }).catch((pushErr) => logger.error('Push notification failed:', { error: pushErr.message }));

    const { rows: updRows } = await db.query(
      'SELECT quantity, low_stock_threshold, low_stock_alerted FROM products WHERE id = $1',
      [product_id],
    );
    const updated = updRows[0];
    if (updated && updated.quantity <= updated.low_stock_threshold && !updated.low_stock_alerted) {
      await db.query('UPDATE products SET low_stock_alerted = 1 WHERE id = $1', [product_id]);
      sendLowStockAlert({ product: { ...product, quantity: updated.quantity }, farmer })
        .catch((lowStockErr) => logger.error('Low-stock alert failed:', { error: lowStockErr.message }));
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
    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2, escrow_balance_id = $3 WHERE id = $4', ['paid', txHash, balanceId, orderId]);

    // Cleanup and notifications
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

    await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', ['paid', txHash, orderId]);

    // Referral bonus
    if (buyer.referred_by && buyer.referral_bonus_sent === 0) {
      const { rows: refRows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [buyer.referred_by]);
      const treasury = process.env.MARKETPLACE_TREASURY_SECRET;
      if (refRows[0] && treasury) {
        sendPayment({ senderSecret: treasury, receiverPublicKey: refRows[0].stellar_public_key, amount: 1.0, memo: `Ref Bonus: ${buyer.name}`.slice(0, 28) })
          .then(() => db.query('UPDATE users SET referral_bonus_sent = 1 WHERE id = $1', [buyer.id]))
          .catch(e => console.error('[Ref] Bonus fail:', e.message));
      }
    }

    // Rewards
    const rewardAmt = Math.floor(totalPrice);
    if (rewardAmt > 0) mintRewardTokens(buyer.stellar_public_key, rewardAmt).catch(e => console.error('[Rewards] fail:', e.message));

    // Notifications
    sendOrderEmails({ order: { id: orderId, quantity, total_price: totalPrice, stellar_tx_hash: txHash }, product, buyer, farmer }).catch(e => console.error('[Mail] fail:', e.message));
    sendPushToUser(farmer.id, { title: 'New order', body: `${buyer.name} ordered ${product.name}`, url: '/dashboard' }).catch(e => console.error('[Push] fail:', e.message));

    // Cleanup & Cache
    if (appliedCoupon) await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [appliedCoupon.id]);
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
    // Rollback stock and update order status on payment failure
    await db.query('UPDATE orders SET status=$1 WHERE id=$2', ['failed', orderId]);
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, product_id]);
    res.status(402).json({ success: false, message: 'Payment failed: ' + e.message, code: 'payment_failed', orderId });
  }
});

// GET /api/orders
router.get('/', auth, async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
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
  const { rows: cRows } = await db.query(`SELECT COUNT(*) as count FROM orders o ${where}`, params);
  const total = parseInt(cRows[0].count);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, p.pricing_model, u.name as farmer_name
     FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON p.farmer_id = u.id
     ${where} ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
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
    `SELECT o.*, p.name as product_name, p.unit, u.name as farmer_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     ${where}
     ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  res.json({ success: true, data, total, page, limit });
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
// GET /api/orders/sales
router.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const { rows: cRows } = await db.query(`SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1`, [req.user.id]);
  const total = parseInt(cRows[0].count);

  const { rows: data } = await db.query(
    `SELECT o.*, p.name as product_name, u.name as buyer_name
     FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON o.buyer_id = u.id
     WHERE p.farmer_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1`,
    [req.user.id],
    'SELECT COUNT(*) as count FROM orders o JOIN products p ON o.product_id = p.id WHERE p.farmer_id = $1',
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
router.patch('/:id/status', auth, validate.updateOrderStatus, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { status } = req.body;
  const { rows } = await db.query(
    `SELECT o.*, p.name as product_name, p.unit, u.name as buyer_name, u.email as buyer_email
     FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON o.buyer_id = u.id
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
  }).catch((pushErr) => console.error('Push notification failed:', pushErr.message));
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

  await db.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);
  sendStatusUpdateEmail({ order, product: { name: order.product_name, unit: order.unit }, buyer: { name: order.buyer_name, email: order.buyer_email }, newStatus: status }).catch(e => console.error('[Mail] fail:', e.message));
  sendPushToUser(order.buyer_id, { title: 'Order Status', body: `Order #${order.id} is now ${status}`, url: '/orders' }).catch(e => console.error('[Push] fail:', e.message));
  res.json({ success: true, message: 'Status updated' });
});

// Dispute & Refund handlers (Soroban Escrow)
router.post('/:id/dispute', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  const order = rows[0];
  if (!order || (order.buyer_id !== req.user.id && req.user.role !== 'farmer')) return err(res, 403, 'Forbidden', 'forbidden');
  if (!String(order.escrow_balance_id || '').startsWith('soroban:')) return err(res, 400, 'Not a Soroban order', 'invalid_state');
  
  const { rows: uRows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const result = await invokeEscrowContract({ action: 'dispute', senderSecret: uRows[0].stellar_secret_key, orderId: Number(order.id) });
    res.json({ success: true, txHash: result.txHash });
  } catch (e) { res.status(402).json({ success: false, message: e.message }); }
});

router.post('/:id/refund', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Buyers only', 'forbidden');
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 AND buyer_id = $2', [req.params.id, req.user.id]);
  const order = rows[0];
  if (!order || !String(order.escrow_balance_id || '').startsWith('soroban:')) return err(res, 400, 'Not a Soroban order', 'invalid_state');

  const { rows: uRows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const result = await invokeEscrowContract({ action: 'refund', senderSecret: uRows[0].stellar_secret_key, orderId: Number(order.id) });
    await db.query('UPDATE orders SET escrow_status = $1, stellar_tx_hash = $2 WHERE id = $3', ['refunded', result.txHash, order.id]);
    res.json({ success: true, txHash: result.txHash });
  } catch (e) { res.status(402).json({ success: false, message: e.message }); }
    return res.json({ success: true, txHash: result.txHash });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Refund failed: ' + e.message, code: 'refund_failed' });
  }
  res.json({ success: true, data, total, page, limit });
});

module.exports = router;
