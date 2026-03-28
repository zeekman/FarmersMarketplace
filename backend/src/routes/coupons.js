const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

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

// Resolve a coupon row and validate it against a farmer + total
function resolveCoupon(code, farmerId) {
  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code.toUpperCase());
  if (!coupon) return { error: 'Invalid coupon code', code: 'invalid_coupon' };
  if (coupon.farmer_id !== farmerId) return { error: 'Coupon not valid for this product', code: 'invalid_coupon' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { error: 'Coupon has expired', code: 'coupon_expired' };
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) return { error: 'Coupon usage limit reached', code: 'coupon_exhausted' };
  return { coupon };
}

function calcDiscount(coupon, subtotal) {
  if (coupon.discount_type === 'percent') {
    return Math.min(parseFloat((subtotal * coupon.discount_value / 100).toFixed(7)), subtotal);
  }
  return Math.min(coupon.discount_value, subtotal);
}

// POST /api/coupons — farmer creates a coupon
router.post('/', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can create coupons', 'forbidden');

  const { code, discount_type, discount_value, max_uses, expires_at } = req.body;
  if (!code || !discount_type || !discount_value)
    return err(res, 400, 'code, discount_type, and discount_value are required', 'validation_error');
  if (!['percent', 'fixed'].includes(discount_type))
    return err(res, 400, 'discount_type must be percent or fixed', 'validation_error');
  const value = parseFloat(discount_value);
  if (isNaN(value) || value <= 0)
    return err(res, 400, 'discount_value must be a positive number', 'validation_error');
  if (discount_type === 'percent' && value > 100)
    return err(res, 400, 'Percent discount cannot exceed 100', 'validation_error');

  try {
    const result = db.prepare(
      'INSERT INTO coupons (farmer_id, code, discount_type, discount_value, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, code.toUpperCase(), discount_type, value, max_uses || null, expires_at || null);
    res.json({ success: true, id: result.lastInsertRowid, code: code.toUpperCase() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return err(res, 409, 'Coupon code already exists', 'conflict');
    throw e;
  }
});

// GET /api/coupons — farmer lists their own coupons
router.get('/', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const coupons = db.prepare('SELECT * FROM coupons WHERE farmer_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ success: true, data: coupons });
});

// DELETE /api/coupons/:id — farmer deletes own coupon
router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!coupon) return err(res, 404, 'Coupon not found', 'not_found');
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/coupons/validate — buyer checks a coupon for a product
router.post('/validate', auth, async (req, res) => {
  const { code, product_id } = req.body;
  if (!code || !product_id) return err(res, 400, 'code and product_id are required', 'validation_error');

  const { rows: prodRows } = await db.query('SELECT id, price, farmer_id FROM products WHERE id = $1', [product_id]);
  const product = prodRows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const quantity = parseInt(req.body.quantity) || 1;
  const unitPrice = await getTierPrice(product_id, quantity);
  const subtotal = unitPrice * quantity;

  const { coupon, error, code: errCode } = resolveCoupon(code, product.farmer_id);
  if (error) return err(res, 400, error, errCode);

  const discount = calcDiscount(coupon, subtotal);
  res.json({
    success: true,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    discount,
    final_total: parseFloat((subtotal - discount).toFixed(7)),
  });
});

module.exports = router;
module.exports.resolveCoupon = resolveCoupon;
module.exports.calcDiscount = calcDiscount;
