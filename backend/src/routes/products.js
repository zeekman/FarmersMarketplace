const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const cache = require('../cache');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const { sendBackInStockEmail } = require('../utils/mailer');
const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');

const VALID_ALLERGENS = ['gluten', 'nuts', 'dairy', 'eggs', 'soy', 'shellfish'];

function parseAllowedRegions(value) {
  if (value === undefined || value === null) return null;
  const arr = Array.isArray(value) ? value : [];
  if (arr.length === 0) return null;
  return JSON.stringify(arr.map((c) => String(c).toUpperCase().trim()).filter(Boolean));
}

function parseAndValidateAllergens(value) {
  if (value === undefined || value === null) return { allergens: null };
  const arr = Array.isArray(value) ? value : [];
  const invalid = arr.find((a) => !VALID_ALLERGENS.includes(a));
  if (invalid) return { error: `Invalid allergen: "${invalid}". Must be one of: ${VALID_ALLERGENS.join(', ')}` };
  return { allergens: arr.length > 0 ? JSON.stringify(arr) : null };
}

function normalizePreorderInput(body) {
  const isPreorder = body.is_preorder === true || body.is_preorder === 1 || body.is_preorder === '1';
  let preorderDeliveryDate = body.preorder_delivery_date || null;
  if (preorderDeliveryDate) preorderDeliveryDate = String(preorderDeliveryDate).trim();
  if (isPreorder && (!preorderDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(preorderDeliveryDate))) {
    return { error: 'preorder_delivery_date must be provided as YYYY-MM-DD' };
  }
  return { isPreorder, preorderDeliveryDate };
}

/**
/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Browse all products (paginated, filterable)
 *     tags: [Products]
 */
// GET /api/products - public browse with optional filters
router.get('/', async (req, res) => {
  const role = req.user?.role || 'public';
  const cacheKey = `products:${role}:${JSON.stringify(req.query)}`;
  const cached = await cache.get(cacheKey);
  if (cached) return res.json(cached);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const { category, minPrice, maxPrice, seller, available = 'true', lat, lng, radius, grade } = req.query;

  const conditions = [];
  const params = [];

  if (available === 'true') conditions.push('p.quantity > 0');
  conditions.push(`(p.best_before IS NULL OR p.best_before >= ${db.isPostgres ? 'CURRENT_DATE' : "date('now')"})`);

  if (category) {
    conditions.push(`p.category = $${params.length + 1}`);
    params.push(category);
  }
  if (minPrice !== undefined) {
    const min = parseFloat(minPrice);
    if (!Number.isNaN(min)) {
      conditions.push(`p.price >= $${params.length + 1}`);
      params.push(min);
    }
  }
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!Number.isNaN(max)) {
      conditions.push(`p.price <= $${params.length + 1}`);
      params.push(max);
    }
  }
  if (seller) {
    conditions.push(`u.name ${db.isPostgres ? 'ILIKE' : 'LIKE'} $${params.length + 1}`);
    params.push(`%${seller}%`);
  }
  if (grade) {
    const VALID_GRADES = ['A', 'B', 'C', 'Ungraded'];
    if (VALID_GRADES.includes(grade)) {
      conditions.push(`p.grade = $${params.length + 1}`);
      params.push(grade);
    }
  }

  const filterLat = parseFloat(lat);
  const filterLng = parseFloat(lng);
  const filterRadius = parseFloat(radius);
  if (!Number.isNaN(filterLat) && !Number.isNaN(filterLng) && !Number.isNaN(filterRadius) && filterRadius > 0) {
    conditions.push('u.latitude IS NOT NULL AND u.longitude IS NOT NULL');
    conditions.push(
      `(6371 * acos(LEAST(1.0, cos(radians($${params.length + 1})) * cos(radians(u.latitude)) * cos(radians(u.longitude) - radians($${params.length + 2})) + sin(radians($${params.length + 1})) * sin(radians(u.latitude))))) <= $${params.length + 3}`
    );
    params.push(filterLat, filterLng, filterRadius);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`,
    params
  );
  const total = parseInt(countRows[0].count);

  const VALID_SORTS = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', newest: 'p.created_at DESC', popular: 'order_count DESC' };
  const sortKey = VALID_SORTS[req.query.sort] ? req.query.sort : 'newest';
  const orderBy = VALID_SORTS[sortKey];
  const popularJoin = sortKey === 'popular'
    ? `LEFT JOIN (SELECT product_id, COUNT(*) as order_count FROM orders WHERE status='paid' GROUP BY product_id) oc ON oc.product_id = p.id`
    : '';
  const popularSelect = sortKey === 'popular' ? ', COALESCE(oc.order_count, 0) as order_count' : '';

  const { rows: products } = await db.query(
    `SELECT p.*, u.name as farmer_name, u.latitude as farmer_lat, u.longitude as farmer_lng, u.farm_address as farmer_farm_address,
            ROUND(AVG(r.rating)${db.isPostgres ? '::numeric' : ''}, 1) as avg_rating,
            COUNT(r.id) as review_count${popularSelect}
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     ${popularJoin}
     ${where}
     GROUP BY p.id, u.name, u.latitude, u.longitude, u.farm_address${sortKey === 'popular' ? ', oc.order_count' : ''}
     ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const payload = { success: true, data: products, total, page, limit, totalPages: Math.ceil(total / limit) };
  if (role !== 'farmer') {
    payload.data = payload.data.map(({ low_stock_threshold, ...rest }) => rest);
  }
  await cache.set(cacheKey, payload, 60);
  res.json(payload);
});

// GET /api/products/search
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    const { rows } = await db.query(
      `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC LIMIT 100`
    );
    return res.json({ success: true, data: rows });
  }
  const like = `%${q}%`;
  const { rows } = await db.query(
    `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id
     WHERE p.name ${db.isPostgres ? 'ILIKE' : 'LIKE'} $1 OR p.description ${db.isPostgres ? 'ILIKE' : 'LIKE'} $2
     ORDER BY p.created_at DESC LIMIT 100`,
    [like, like]
  );
  res.json({ success: true, data: rows });
});

// GET /api/products/categories
router.get('/categories', async (_req, res) => {
  const { rows } = await db.query(
    'SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category'
  );
  res.json({ success: true, data: rows.map((r) => r.category) });
});

// GET /api/products/mine/list
router.get('/mine/list', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { rows } = await db.query(
    'SELECT * FROM products WHERE farmer_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/products/upload-image
router.post('/upload-image', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can upload images', 'forbidden');
  upload.single('image')(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') return err(res, 400, 'Image must be 5 MB or smaller', 'file_too_large');
      return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.file) return err(res, 400, 'No image file provided', 'no_file');
    res.json({ success: true, imageUrl: `/uploads/${req.file.filename}` });
  });
});

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Product detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Product' }
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product listing (farmer only)
 *     tags: [Products]
 */
// POST /api/products
router.post('/', auth, validate.product, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can list products', 'forbidden');

  const { name, description, unit, category, image_url, nutrition } = req.body;
  const price = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim()) return err(res, 400, 'Product name is required', 'validation_error');
  if (Number.isNaN(price) || price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  if (Number.isNaN(quantity) || quantity < 1) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  const preorder = normalizePreorderInput(req.body);
  if (preorder.error) return err(res, 400, preorder.error, 'validation_error');

  const allergenResult = parseAndValidateAllergens(req.body.allergens);
  if (allergenResult.error) return err(res, 400, allergenResult.error, 'validation_error');

  const safeName        = sanitizeText(name);
  const safeDescription = sanitizeText(description || '');
  const safeUnit        = sanitizeText(unit || 'unit');
  const safeCategory    = sanitizeText(category || 'other');
  const safeImageUrl    = image_url && /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(image_url) ? image_url : null;

  const pricingType = req.body.pricing_type === 'weight' ? 'weight' : 'unit';
  const minWeight   = pricingType === 'weight' ? parseFloat(req.body.min_weight) : null;
  const maxWeight   = pricingType === 'weight' ? parseFloat(req.body.max_weight) : null;

  let batchId = null;
  if (req.body.batch_id !== undefined && req.body.batch_id !== null && req.body.batch_id !== '') {
    batchId = parseInt(req.body.batch_id, 10);
    if (Number.isNaN(batchId) || batchId < 1) return err(res, 400, 'batch_id must be a positive integer', 'validation_error');
    const { rows: bRows } = await db.query(
      'SELECT id FROM harvest_batches WHERE id = $1 AND farmer_id = $2',
      [batchId, req.user.id]
    );
    if (!bRows[0]) return err(res, 400, 'Invalid batch_id or not your batch', 'invalid_batch');
  }

  const { rows } = await db.query(
    `INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url,
      low_stock_threshold, nutrition, pricing_type, min_weight, max_weight, batch_id,
      is_preorder, preorder_delivery_date, allergens, allowed_regions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [
      req.user.id, safeName, safeDescription, safeCategory, price, quantity, safeUnit, safeImageUrl,
      parseInt(req.body.low_stock_threshold, 10) || 5, nutrition ? JSON.stringify(nutrition) : null,
      pricingType, minWeight, maxWeight, batchId,
      preorder.isPreorder ? 1 : 0, preorder.preorderDeliveryDate,
      allergenResult.allergens, parseAllowedRegions(req.body.allowed_regions),
    ]
  );
  const productId = rows[0].id;
  await db.query('INSERT INTO price_history (product_id, price) VALUES ($1, $2)', [productId, price]);
  await cache.del('products:{}');
  res.json({ success: true, id: productId, message: 'Product listed' });
});

/**
 * @swagger
 * /api/products/{id}:
 *   patch:
 *     summary: Update a product listing (farmer only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number, description: Price in XLM, must be positive }
 *               quantity:
 *                 type: integer
 *                 minimum: 0
 *                 description: >
 *                   Stock quantity. Must be a non-negative integer.
 *                   Setting quantity to 0 hides the product from public listings
 *                   (GET /api/products) but the product remains visible to the
 *                   farmer via GET /api/products/mine/list.
 *               unit: { type: string }
 *               category: { type: string }
 *               low_stock_threshold: { type: integer, minimum: 0 }
 *     responses:
 *       200:
 *         description: Product updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Only farmers can edit products
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Not found or not yours
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// PATCH /api/products/bulk-price
router.patch('/bulk-price', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const { updates, adjustment_percent } = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return err(res, 400, 'updates must be a non-empty array of { id, price }', 'validation_error');
  }
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    if (!u.id || typeof u.id !== 'number') return err(res, 400, `updates[${i}].id must be a number`, 'validation_error');
    if (adjustment_percent == null && (typeof u.price !== 'number' || u.price <= 0)) {
      return err(res, 400, `updates[${i}].price must be a positive number`, 'validation_error');
    }
  }
  if (adjustment_percent != null && typeof adjustment_percent !== 'number') {
    return err(res, 400, 'adjustment_percent must be a number', 'validation_error');
  }

  const ids = updates.map((u) => u.id);
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
  const { rows: owned } = await db.query(
    `SELECT id, price FROM products WHERE farmer_id = $1 AND id IN (${placeholders})`,
    [req.user.id, ...ids]
  );
  const ownedIds = new Set(owned.map((r) => Number(r.id)));

  const updated = [];
  const failed = [];
  for (const u of updates) {
    if (!ownedIds.has(u.id)) { failed.push({ id: u.id, reason: 'Not found or not owned by you' }); continue; }
    let newPrice = adjustment_percent != null
      ? parseFloat((owned.find((r) => Number(r.id) === u.id).price * (1 + adjustment_percent / 100)).toFixed(7))
      : u.price;
    if (newPrice <= 0) { failed.push({ id: u.id, reason: 'Computed price must be positive' }); continue; }
    await db.query('UPDATE products SET price = $1 WHERE id = $2', [newPrice, u.id]);
    updated.push({ id: u.id, price: newPrice });
  }
  res.json({ success: true, data: { updated, failed } });
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location,
            u.avatar_url as farmer_avatar, u.stellar_public_key as farmer_wallet,
            hb.batch_code as harvest_batch_code, hb.harvest_date as harvest_batch_date, hb.notes as harvest_batch_notes,
            ROUND(AVG(r.rating)${db.isPostgres ? '::numeric' : ''}, 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     LEFT JOIN harvest_batches hb ON hb.id = p.batch_id
     WHERE p.id = $1
     GROUP BY p.id, u.name, u.bio, u.location, u.avatar_url, u.stellar_public_key,
              hb.batch_code, hb.harvest_date, hb.notes`,
    [req.params.id]
  );
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  res.json({ success: true, data: rows[0] });
});

// PATCH /api/products/:id
router.patch('/:id', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can edit products', 'forbidden');

  const { rows: existing } = await db.query(
    'SELECT * FROM products WHERE id = $1 AND farmer_id = $2',
    [req.params.id, req.user.id]
  );
  if (!existing[0]) return err(res, 404, 'Not found or not yours', 'not_found');
  const product = existing[0];

  const allowed = [
    'name', 'description', 'price', 'quantity', 'unit', 'category',
    'low_stock_threshold', 'nutrition', 'pricing_type', 'min_weight', 'max_weight',
    'batch_id', 'is_preorder', 'preorder_delivery_date', 'allergens', 'allowed_regions',
    'grade', 'carbon_kg_per_unit',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return err(res, 400, 'No valid fields to update', 'validation_error');

  if (updates.name !== undefined) updates.name = sanitizeText(updates.name);
  if (updates.description !== undefined) updates.description = sanitizeText(updates.description);
  if (updates.unit !== undefined) updates.unit = sanitizeText(updates.unit);
  if (updates.category !== undefined) updates.category = sanitizeText(updates.category);
  if (updates.price !== undefined) {
    updates.price = parseFloat(updates.price);
    if (Number.isNaN(updates.price) || updates.price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  }
  if (updates.quantity !== undefined) {
    updates.quantity = parseInt(updates.quantity, 10);
    if (Number.isNaN(updates.quantity) || updates.quantity < 0) return err(res, 400, 'Quantity must be non-negative', 'validation_error');
  }
  if (updates.low_stock_threshold !== undefined) {
    updates.low_stock_threshold = parseInt(updates.low_stock_threshold, 10);
    if (Number.isNaN(updates.low_stock_threshold) || updates.low_stock_threshold < 0) {
      return err(res, 400, 'Threshold must be non-negative', 'validation_error');
    }
  }
  if (updates.nutrition !== undefined) {
    updates.nutrition = updates.nutrition ? JSON.stringify(updates.nutrition) : null;
  }
  if (updates.allergens !== undefined) {
    const allergenResult = parseAndValidateAllergens(updates.allergens);
    if (allergenResult.error) return err(res, 400, allergenResult.error, 'validation_error');
    updates.allergens = allergenResult.allergens;
  }
  if (updates.allowed_regions !== undefined) {
    updates.allowed_regions = parseAllowedRegions(updates.allowed_regions);
  }
  if (updates.grade !== undefined) {
    const VALID_GRADES = ['A', 'B', 'C', 'Ungraded'];
    if (!VALID_GRADES.includes(updates.grade)) return err(res, 400, 'grade must be A, B, C, or Ungraded', 'validation_error');
  }
  if (updates.batch_id !== undefined) {
    if (updates.batch_id === null || updates.batch_id === '') {
      updates.batch_id = null;
    } else {
      const bid = parseInt(updates.batch_id, 10);
      if (Number.isNaN(bid) || bid < 1) return err(res, 400, 'batch_id must be a positive integer or null', 'validation_error');
      const { rows: bRows } = await db.query('SELECT id FROM harvest_batches WHERE id = $1 AND farmer_id = $2', [bid, req.user.id]);
      if (!bRows[0]) return err(res, 400, 'Invalid batch_id or not your batch', 'invalid_batch');
      updates.batch_id = bid;
    }
  }

  const nextIsPreorder = updates.is_preorder !== undefined
    ? (updates.is_preorder === true || updates.is_preorder === 1 || updates.is_preorder === '1')
    : !!product.is_preorder;
  const nextDeliveryDate = updates.preorder_delivery_date !== undefined
    ? (updates.preorder_delivery_date ? String(updates.preorder_delivery_date).trim() : null)
    : product.preorder_delivery_date;
  if (nextIsPreorder) {
    if (!nextDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDeliveryDate)) {
      return err(res, 400, 'preorder_delivery_date must be provided as YYYY-MM-DD for pre-order products', 'validation_error');
    }
    updates.is_preorder = 1;
    updates.preorder_delivery_date = nextDeliveryDate;
  } else {
    updates.is_preorder = 0;
    updates.preorder_delivery_date = null;
  }

  const newQty = updates.quantity ?? product.quantity;
  const newThreshold = updates.low_stock_threshold ?? product.low_stock_threshold ?? 5;
  if (newQty > newThreshold) updates.low_stock_alerted = 0;

  const keys = Object.keys(updates);
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(
    `UPDATE products SET ${setClauses} WHERE id = $${keys.length + 1}`,
    [...Object.values(updates), req.params.id]
  );

  if (updates.price !== undefined) {
    await db.query('INSERT INTO price_history (product_id, price) VALUES ($1, $2)', [req.params.id, updates.price]);
  }

  res.json({ success: true, message: 'Product updated' });
});

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete a product listing (farmer only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Product deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *       404:
 *         description: Not found or not yours
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Conflict - product has open or paid orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 error: { type: string }
 *                 code: { type: string }
 *                 openOrders: { type: array }
 */
// DELETE /api/products/:id
router.delete('/:id', auth, async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM products WHERE id = $1 AND farmer_id = $2',
    [req.params.id, req.user.id]
  );
  if (rowCount === 0) return err(res, 404, 'Not found or not yours', 'not_found');
  await cache.del('products:{}');
  res.json({ success: true, message: 'Deleted' });
});

// PATCH /api/products/:id/restock
router.patch('/:id/restock', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can restock products', 'forbidden');
  const quantity = parseInt(req.body.quantity, 10);
  if (Number.isNaN(quantity) || quantity <= 0) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  try {
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
    const product = rows[0];
    if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

    const wasOutOfStock = product.quantity === 0;
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, req.params.id]);

    let waitlistResults = null;
    if (wasOutOfStock) {
      const processor = new AutomaticOrderProcessor();
      waitlistResults = await processor.processWaitlistOnRestock(parseInt(req.params.id), quantity);
      if (!waitlistResults.success) console.error('[Restock] Waitlist processing failed:', waitlistResults.error);

      const { rows: subscribers } = await db.query(
        `SELECT u.email, u.name FROM stock_alerts sa JOIN users u ON sa.user_id = u.id WHERE sa.product_id = $1`,
        [req.params.id]
      );
      if (subscribers.length > 0) {
        await db.query('DELETE FROM stock_alerts WHERE product_id = $1', [req.params.id]);
        Promise.all(subscribers.map((s) => sendBackInStockEmail({ email: s.email, name: s.name, productName: product.name })))
          .catch((e) => console.error('[stock-alert] Email send failed:', e.message));
      }
    }

    const response = { success: true, message: 'Restocked successfully' };
    if (waitlistResults) {
      response.waitlist = {
        processed: waitlistResults.processed || 0,
        skipped: waitlistResults.skipped || 0,
        totalEntries: waitlistResults.totalEntries || 0,
        remainingStock: waitlistResults.remainingStock || quantity,
        errors: waitlistResults.errors || [],
      };
    }
    res.json(response);
  } catch (error) {
    console.error('[Restock] Error processing restock:', error);
    return err(res, 500, 'Internal server error during restock', 'internal_error');
  }
});

// POST /api/products/:id/alert
router.post('/:id/alert', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can set alerts', 'forbidden');
  const { rows } = await db.query('SELECT id, quantity FROM products WHERE id = $1', [req.params.id]);
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  if (rows[0].quantity > 0) return err(res, 400, 'Product is already in stock', 'in_stock');
  try {
    await db.query('INSERT INTO stock_alerts (user_id, product_id) VALUES ($1, $2)', [req.user.id, req.params.id]);
    res.json({ success: true, message: 'Alert set' });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.code === '23505') return err(res, 409, 'Alert already set', 'conflict');
    throw e;
  }
});

// DELETE /api/products/:id/alert
router.delete('/:id/alert', auth, async (req, res) => {
  await db.query('DELETE FROM stock_alerts WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.id]);
  res.json({ success: true, message: 'Alert removed' });
});

// GET /api/products/:id/alert/status
router.get('/:id/alert/status', auth, async (req, res) => {
  const { rows } = await db.query('SELECT id FROM stock_alerts WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.id]);
  res.json({ success: true, subscribed: !!rows[0] });
});

// GET /api/products/:id/images
router.get('/:id/images', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC',
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/products/:id/images
router.post('/:id/images', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can upload images', 'forbidden');
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Product not found or not yours', 'not_found');

  upload.array('images', 5)(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') return err(res, 400, 'Each image must be 5 MB or smaller', 'file_too_large');
      if (uploadErr.code === 'LIMIT_UNEXPECTED_FILE') return err(res, 400, 'Maximum 5 images allowed', 'too_many_files');
      if (uploadErr.code === 'INVALID_TYPE') return err(res, 400, uploadErr.message, 'invalid_file_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.files || req.files.length === 0) return err(res, 400, 'No image files provided', 'no_file');

    const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM product_images WHERE product_id = $1', [req.params.id]);
    const existing = parseInt(countRows[0].count);
    if (existing + req.files.length > 5) return err(res, 400, `Cannot exceed 5 images. Currently have ${existing}.`, 'too_many_files');

    const { rows: maxRows } = await db.query('SELECT MAX(sort_order) as m FROM product_images WHERE product_id = $1', [req.params.id]);
    const maxOrder = maxRows[0].m ?? -1;

    for (let i = 0; i < req.files.length; i++) {
      await db.query(
        'INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)',
        [req.params.id, `/uploads/${req.files[i].filename}`, maxOrder + 1 + i]
      );
    }

    const { rows: images } = await db.query(
      'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC',
      [req.params.id]
    );
    if (images.length > 0) await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [images[0].url, req.params.id]);
    res.json({ success: true, data: images });
  });
});

// DELETE /api/products/:id/images/:imgId
router.delete('/:id/images/:imgId', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can delete images', 'forbidden');
  const { rows: pRows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!pRows[0]) return err(res, 404, 'Product not found or not yours', 'not_found');
  const { rows: iRows } = await db.query('SELECT * FROM product_images WHERE id = $1 AND product_id = $2', [req.params.imgId, req.params.id]);
  if (!iRows[0]) return err(res, 404, 'Image not found', 'not_found');

  await db.query('DELETE FROM product_images WHERE id = $1', [req.params.imgId]);
  const fs = require('fs');
  const filePath = require('path').join(__dirname, '../../uploads', require('path').basename(iRows[0].url));
  try { fs.unlinkSync(filePath); } catch {}

  const { rows: firstRows } = await db.query(
    'SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC LIMIT 1',
    [req.params.id]
  );
  await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [firstRows[0]?.url ?? null, req.params.id]);
  res.json({ success: true, message: 'Image deleted' });
});

// PATCH /api/products/:id/images/reorder
router.patch('/:id/images/reorder', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can reorder images', 'forbidden');
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Product not found or not yours', 'not_found');

  const { order } = req.body;
  if (!Array.isArray(order)) return err(res, 400, 'order must be an array', 'validation_error');
  for (const { id, sort_order } of order) {
    await db.query('UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3', [sort_order, id, req.params.id]);
  }

  const { rows: firstRows } = await db.query(
    'SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC LIMIT 1',
    [req.params.id]
  );
  if (firstRows[0]) await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [firstRows[0].url, req.params.id]);

  const { rows: images } = await db.query(
    'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC',
    [req.params.id]
  );
  res.json({ success: true, data: images });
});

// GET /api/products/:id/carbon
router.get('/:id/carbon', async (req, res) => {
  const { lat, lng } = req.query;
  const { rows } = await db.query(
    `SELECT p.*, u.location, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');

  const product = rows[0];
  const { estimateCarbonFootprint, calculateDistance } = require('../utils/carbon');
  let distanceKm = 0;
  if (lat && lng && product.location) {
    const locMatch = product.location.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
    if (locMatch) distanceKm = calculateDistance(parseFloat(lat), parseFloat(lng), parseFloat(locMatch[1]), parseFloat(locMatch[2]));
  }
  const estimate = estimateCarbonFootprint(product, 1, distanceKm);
  res.json({
    success: true,
    data: {
      productId: product.id,
      productName: product.name,
      category: product.category,
      carbonKgPerUnit: estimate.carbonKg,
      supermarketCarbonKg: estimate.supermarketCarbonKg,
      savingsPercent: estimate.savingsPercent,
      distanceKm: Math.round(distanceKm),
    },
  });
});

// GET /api/products/:id/tiers
router.get('/:id/tiers', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, min_quantity, price_per_unit FROM price_tiers WHERE product_id = $1 ORDER BY min_quantity ASC',
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/products/:id/tiers
router.post('/:id/tiers', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can manage price tiers', 'forbidden');
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Product not found or not yours', 'not_found');

  const { tiers } = req.body;
  if (!Array.isArray(tiers)) return err(res, 400, 'tiers must be an array', 'validation_error');

  const sortedTiers = tiers.sort((a, b) => a.min_quantity - b.min_quantity);
  for (let i = 0; i < sortedTiers.length; i++) {
    const tier = sortedTiers[i];
    if (!tier.min_quantity || tier.min_quantity < 1 || !Number.isInteger(tier.min_quantity)) return err(res, 400, 'min_quantity must be a positive integer', 'validation_error');
    if (!tier.price_per_unit || tier.price_per_unit <= 0) return err(res, 400, 'price_per_unit must be a positive number', 'validation_error');
    if (i > 0 && tier.min_quantity <= sortedTiers[i - 1].min_quantity) return err(res, 400, 'min_quantity values must be increasing', 'validation_error');
  }

  await db.query('DELETE FROM price_tiers WHERE product_id = $1', [req.params.id]);
  for (const tier of sortedTiers) {
    await db.query('INSERT INTO price_tiers (product_id, min_quantity, price_per_unit) VALUES ($1, $2, $3)', [req.params.id, tier.min_quantity, tier.price_per_unit]);
  }

  const { rows: newTiers } = await db.query(
    'SELECT id, min_quantity, price_per_unit FROM price_tiers WHERE product_id = $1 ORDER BY min_quantity ASC',
    [req.params.id]
  );
  res.json({ success: true, data: newTiers });
});

// GET /api/products/:id/price-history
router.get('/:id/price-history', async (req, res) => {
  const cutoff = db.isPostgres ? `NOW() - INTERVAL '30 days'` : `datetime('now', '-30 days')`;
  const { rows } = await db.query(
    `SELECT price, recorded_at FROM price_history WHERE product_id = $1 AND recorded_at >= ${cutoff} ORDER BY recorded_at ASC`,
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

module.exports = router;
