const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const { sendBackInStockEmail } = require('../utils/mailer');
const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');

function normalizePreorderInput(body) {
  const isPreorder =
    body.is_preorder === true || body.is_preorder === 1 || body.is_preorder === '1';

  let preorderDeliveryDate = body.preorder_delivery_date || null;
  if (preorderDeliveryDate) {
    preorderDeliveryDate = String(preorderDeliveryDate).trim();
  }

  if (isPreorder) {
    if (!preorderDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(preorderDeliveryDate)) {
      return { error: 'preorder_delivery_date must be provided as YYYY-MM-DD for pre-order products' };
    }
  } else {
    preorderDeliveryDate = null;
  }

  return { isPreorder, preorderDeliveryDate };
}

/**
 * @swagger
 * tags:
 *   name: Products
 *   description: Product listings
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Browse all products (paginated, filterable)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: seller
 *         schema: { type: string }
 *       - in: query
 *         name: available
 *         schema: { type: string, default: 'true' }
 *     responses:
 *       200:
 *         description: Paginated product list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Product' }
 */
// GET /api/products - public browse with optional filters
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { category, minPrice, maxPrice, seller, available = 'true' } = req.query;

  const conditions = [];
  const countParams = [];
  const dataParams = [];

  if (available === 'true') conditions.push('p.quantity > 0');

  if (category) {
    conditions.push('p.category = ?');
    countParams.push(category);
    dataParams.push(category);
  }
  if (minPrice !== undefined) {
    const min = parseFloat(minPrice);
    if (!Number.isNaN(min)) {
      conditions.push('p.price >= ?');
      countParams.push(min);
      dataParams.push(min);
    }
  }
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!Number.isNaN(max)) {
      conditions.push('p.price <= ?');
      countParams.push(max);
      dataParams.push(max);
    }
  }
  if (seller) {
    conditions.push('u.name LIKE ?');
    countParams.push(`%${seller}%`);
    dataParams.push(`%${seller}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

router.get('/', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const { category, minPrice, maxPrice, seller, available = 'true', lat, lng, radius } = req.query;

  const conditions = [];
  const params = [];

  if (available === 'true') conditions.push('p.quantity > 0');
  if (category)   { conditions.push(`p.category = $${params.length + 1}`);        params.push(category); }
  if (minPrice !== undefined) { const min = parseFloat(minPrice); if (!isNaN(min)) { conditions.push(`p.price >= $${params.length + 1}`); params.push(min); } }
  if (maxPrice !== undefined) { const max = parseFloat(maxPrice); if (!isNaN(max)) { conditions.push(`p.price <= $${params.length + 1}`); params.push(max); } }
  if (seller)     { conditions.push(`u.name ILIKE $${params.length + 1}`);         params.push(`%${seller}%`); }

  // Haversine distance filter (radius in km)
  const filterLat = parseFloat(lat);
  const filterLng = parseFloat(lng);
  const filterRadius = parseFloat(radius);
  const hasGeoFilter = !isNaN(filterLat) && !isNaN(filterLng) && !isNaN(filterRadius) && filterRadius > 0;
  if (hasGeoFilter) {
    conditions.push(`u.latitude IS NOT NULL AND u.longitude IS NOT NULL`);
    conditions.push(
      `(6371 * acos(LEAST(1.0, cos(radians($${params.length + 1})) * cos(radians(u.latitude)) * cos(radians(u.longitude) - radians($${params.length + 2})) + sin(radians($${params.length + 1})) * sin(radians(u.latitude))))) <= $${params.length + 3}`
    );
    params.push(filterLat, filterLng, filterRadius);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await db.query(
    `SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].count);

  const dataParams = [...params, limit, offset];
  const { rows: products } = await db.query(
    `SELECT p.*, u.name as farmer_name, u.latitude as farmer_lat, u.longitude as farmer_lng, u.farm_address as farmer_farm_address,
            ROUND(AVG(r.rating)::numeric, 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     ${where}
     GROUP BY p.id, u.name, u.latitude, u.longitude, u.farm_address
     ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  res.json({
    success: true,
    data: products,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// GET /api/products/search?q=tomato - FTS5 full-text search
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    const products = db.prepare(
      `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC LIMIT 100`
    ).all();
    return res.json({ success: true, data: products });
  }

  try {
    const products = db.prepare(`
      SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar, fts.rank
      FROM products_fts fts
      JOIN products p ON p.id = fts.rowid
      JOIN users u ON p.farmer_id = u.id
      WHERE products_fts MATCH ?
      ORDER BY fts.rank
      LIMIT 100
    `).all(q);
    res.json({ success: true, data: products });
    const products = db.prepare(
      `SELECT p.*, u.name as farmer_name, fts.rank
       FROM products_fts fts
       JOIN products p ON p.id = fts.rowid
       JOIN users u ON p.farmer_id = u.id
       WHERE products_fts MATCH ?
       ORDER BY fts.rank
       LIMIT 100`
    ).all(q);
    return res.json({ success: true, data: products });
  } catch {
    const like = `%${q}%`;
    const products = db.prepare(
      `SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar FROM products p JOIN users u ON p.farmer_id = u.id
       WHERE p.name LIKE ? OR p.description LIKE ? ORDER BY p.created_at DESC LIMIT 100`
    ).all(like, like);
    return res.json({ success: true, data: products });
     GROUP BY p.id, u.name
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  res.json({ success: true, data: products, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// GET /api/products/search?q=tomato
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
     WHERE p.name ILIKE $1 OR p.description ILIKE $2 ORDER BY p.created_at DESC LIMIT 100`,
    [like, like]
  );
  res.json({ success: true, data: rows });
});

// GET /api/products/categories
router.get('/categories', (_req, res) => {
  const rows = db.prepare(
    'SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category'
  ).all();
  res.json({ success: true, data: rows.map((r) => r.category) });
});

/**
 * @swagger
 * /api/products/mine/list:
 *   get:
 *     summary: Get farmer's own product listings
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of farmer's products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Product' }
 *       403:
 *         description: Farmers only
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// GET /api/products/mine/list - farmer's own products
router.get('/mine/list', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const data = db.prepare(
    'SELECT * FROM products WHERE farmer_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json({ success: true, data });
});

// POST /api/products/upload-image - upload a product image (farmer only)
router.post('/upload-image', auth, (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Only farmers can upload images', 'forbidden');
  }

router.get('/categories', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category`
  );
  res.json({ success: true, data: rows.map(r => r.category) });
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
      if (uploadErr.code === 'INVALID_TYPE') return err(res, 400, uploadErr.message, 'invalid_file_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.file) return err(res, 400, 'No image file provided', 'no_file');

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl });
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
// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar, u.stellar_public_key as farmer_wallet,
           ROUND(AVG(r.rating), 1) as avg_rating,
           COUNT(r.id) as review_count
    FROM products p
    JOIN users u ON p.farmer_id = u.id
    LEFT JOIN reviews r ON r.product_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(req.params.id);

  if (!product) return err(res, 404, 'Product not found', 'not_found');
  res.json({ success: true, data: product });
});

router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, u.name as farmer_name, u.stellar_public_key as farmer_wallet,
            ROUND(AVG(r.rating)::numeric, 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     WHERE p.id = $1
     GROUP BY p.id, u.name, u.stellar_public_key`,
    [req.params.id]
  );
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  res.json({ success: true, data: rows[0] });
});

// PATCH /api/products/:id/restock
router.patch('/:id/restock', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can restock products', 'forbidden');
  
  const quantity = parseInt(req.body.quantity, 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    return err(res, 400, 'Quantity must be a positive integer', 'validation_error');
  }

  try {
    // Get product details
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
    const product = rows[0];
    if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

    const wasOutOfStock = product.quantity === 0;
    
    // Update product stock atomically
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, req.params.id]);

    // Initialize response data
    let waitlistResults = null;

    // Process waitlist if product was out of stock (automatic order processing)
    if (wasOutOfStock) {
      const processor = new AutomaticOrderProcessor();
      waitlistResults = await processor.processWaitlistOnRestock(parseInt(req.params.id), quantity);
      
      if (!waitlistResults.success) {
        console.error('[Restock] Waitlist processing failed:', waitlistResults.error);
        // Don't fail the restock operation, just log the error
      }
    }

    // Handle existing stock alert notifications (backward compatibility)
    if (wasOutOfStock) {
      const { rows: subscribers } = await db.query(
        `SELECT u.email, u.name FROM stock_alerts sa JOIN users u ON sa.user_id = u.id WHERE sa.product_id = $1`,
        [req.params.id]
      );
      
      if (subscribers.length > 0) {
        await db.query('DELETE FROM stock_alerts WHERE product_id = $1', [req.params.id]);
        Promise.all(subscribers.map(s => sendBackInStockEmail({ email: s.email, name: s.name, productName: product.name })))
          .catch(e => console.error('[stock-alert] Email send failed:', e.message));
      }
    }

    // Prepare response with waitlist processing results
    const response = {
      success: true,
      message: 'Restocked successfully'
    };

    // Include waitlist processing results if available
    if (waitlistResults) {
      response.waitlist = {
        processed: waitlistResults.processed || 0,
        skipped: waitlistResults.skipped || 0,
        totalEntries: waitlistResults.totalEntries || 0,
        remainingStock: waitlistResults.remainingStock || quantity,
        errors: waitlistResults.errors || []
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

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product listing (farmer only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, quantity]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               category: { type: string }
 *               price: { type: number, description: Price in XLM }
 *               quantity: { type: integer }
 *               unit: { type: string, example: kg }
 *               image_url: { type: string }
 *               low_stock_threshold: { type: integer, default: 5 }
 *     responses:
 *       200:
 *         description: Product created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 id: { type: integer }
 *                 message: { type: string }
 *       403:
 *         description: Only farmers can list products
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// POST /api/products - farmer only
router.post('/', auth, validate.product, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can list products', 'forbidden');

  const { name, description, unit, category, image_url, nutrition } = req.body;
  const price = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim()) return err(res, 400, 'Product name is required', 'validation_error');
  if (Number.isNaN(price) || price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  if (Number.isNaN(quantity) || quantity < 1) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  const preorder = normalizePreorderInput(req.body);
  if (preorder.error) return err(res, 400, preorder.error, 'validation_error');

  const safeName = sanitizeText(name);
  const safeDescription = sanitizeText(description || '');
  const safeUnit = sanitizeText(unit || 'unit');
  const safeCategory = sanitizeText(category || 'other');

  const safeImageUrl =
    image_url && /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(image_url)
      ? image_url
      : null;

  const result = db.prepare(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url, is_preorder, preorder_delivery_date, low_stock_threshold, nutrition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.user.id,
    safeName,
    safeDescription,
    safeCategory,
    price,
    quantity,
    safeUnit,
    safeImageUrl,
    preorder.isPreorder ? 1 : 0,
    preorder.preorderDeliveryDate,
    parseInt(req.body.low_stock_threshold, 10) || 5,
    nutrition ? JSON.stringify(nutrition) : null,
  );

  res.json({ success: true, id: result.lastInsertRowid, message: 'Product listed' });
});

// PATCH /api/products/:id - farmer updates own product
router.patch('/:id', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can edit products', 'forbidden');

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Not found or not yours', 'not_found');

  const allowed = [
    'name',
    'description',
    'price',
    'quantity',
    'unit',
    'category',
    'low_stock_threshold',
    'is_preorder',
    'preorder_delivery_date',
    'nutrition',
  ];

// POST /api/products
router.post('/', auth, validate.product, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can list products', 'forbidden');

  const { name, description, unit, category, image_url, nutrition } = req.body;
  const price    = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim()) return err(res, 400, 'Product name is required', 'validation_error');
  if (isNaN(price) || price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  if (isNaN(quantity) || quantity < 1) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  const safeName        = sanitizeText(name);
  const safeDescription = sanitizeText(description || '');
  const safeUnit        = sanitizeText(unit || 'unit');
  const safeCategory    = sanitizeText(category || 'other');
  const safeImageUrl    = image_url && /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(image_url) ? image_url : null;

  const pricingType = req.body.pricing_type === 'weight' ? 'weight' : 'unit';
  const minWeight   = pricingType === 'weight' ? parseFloat(req.body.min_weight) : null;
  const maxWeight   = pricingType === 'weight' ? parseFloat(req.body.max_weight) : null;

  const { rows } = await db.query(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url, low_stock_threshold, nutrition, pricing_type, min_weight, max_weight) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
    [req.user.id, safeName, safeDescription, safeCategory, price, quantity, safeUnit, safeImageUrl, parseInt(req.body.low_stock_threshold) || 5, nutrition ? JSON.stringify(nutrition) : null, pricingType, minWeight, maxWeight]
  );
  res.json({ success: true, id: rows[0].id, message: 'Product listed' });
});

// PATCH /api/products/:id
router.patch('/:id', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can edit products', 'forbidden');

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  const product = rows[0];
  if (!product) return err(res, 404, 'Not found or not yours', 'not_found');

  const allowed = ['name', 'description', 'price', 'quantity', 'unit', 'category', 'low_stock_threshold', 'carbon_kg_per_unit'];
  const allowed = ['name', 'description', 'price', 'quantity', 'unit', 'category', 'low_stock_threshold', 'nutrition', 'pricing_type', 'min_weight', 'max_weight'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return err(res, 400, 'No valid fields to update', 'validation_error');

  if (updates.name !== undefined) updates.name = sanitizeText(updates.name);
  if (updates.description !== undefined) updates.description = sanitizeText(updates.description);
  if (updates.unit !== undefined) updates.unit = sanitizeText(updates.unit);
  if (updates.category !== undefined) updates.category = sanitizeText(updates.category);

  if (updates.name !== undefined)        updates.name        = sanitizeText(updates.name);
  if (updates.description !== undefined) updates.description = sanitizeText(updates.description);
  if (updates.unit !== undefined)        updates.unit        = sanitizeText(updates.unit);
  if (updates.category !== undefined)    updates.category    = sanitizeText(updates.category);
  if (updates.price !== undefined) {
    updates.price = parseFloat(updates.price);
    if (Number.isNaN(updates.price) || updates.price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  }

  if (updates.quantity !== undefined) {
    updates.quantity = parseInt(updates.quantity, 10);
    if (Number.isNaN(updates.quantity) || updates.quantity < 0) return err(res, 400, 'Quantity must be non-negative', 'validation_error');
    if (isNaN(updates.price) || updates.price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  }
  if (updates.quantity !== undefined) {
    updates.quantity = parseInt(updates.quantity, 10);
    if (isNaN(updates.quantity) || updates.quantity < 0) return err(res, 400, 'Quantity must be non-negative', 'validation_error');
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

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE products SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);
    if (isNaN(updates.low_stock_threshold) || updates.low_stock_threshold < 0) return err(res, 400, 'Threshold must be non-negative', 'validation_error');
  }

  const newQty       = updates.quantity ?? product.quantity;
  const newThreshold = updates.low_stock_threshold ?? product.low_stock_threshold ?? 5;
  if (newQty > newThreshold) updates.low_stock_alerted = 0;

  if (updates.nutrition !== undefined) {
    updates.nutrition = updates.nutrition ? JSON.stringify(updates.nutrition) : null;
  }

  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(`UPDATE products SET ${setClauses} WHERE id = $${keys.length + 1}`, [...values, req.params.id]);

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
 */
// DELETE /api/products/:id
router.delete('/:id', auth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Not found or not yours', 'not_found');

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
router.delete('/:id', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Not found or not yours', 'not_found');
  await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Deleted' });
});

// GET /api/products/:id/images
router.get('/:id/images', (req, res) => {
  const images = db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC')
    .all(req.params.id);
  res.json({ success: true, data: images });
});

// POST /api/products/:id/images - upload up to 5 images (farmer only)
router.post('/:id/images', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can upload images', 'forbidden');

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

  upload.array('images', 5)(req, res, (uploadErr) => {
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

    const existing = db.prepare('SELECT COUNT(*) as count FROM product_images WHERE product_id = ?').get(req.params.id).count;
    if (existing + req.files.length > 5) {
      return err(res, 400, `Cannot exceed 5 images. Currently have ${existing}.`, 'too_many_files');
    }

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?').get(req.params.id).m ?? -1;

    const insert = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)');
    db.transaction((files) => {
      files.forEach((f, i) => {
        insert.run(req.params.id, `/uploads/${f.filename}`, maxOrder + 1 + i);
      });
    })(req.files);

    const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(req.params.id);
    if (images.length > 0) {
      db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(images[0].url, req.params.id);
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
    if (images.length > 0) {
      await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [images[0].url, req.params.id]);
    }
    res.json({ success: true, data: images });
  });
});

// DELETE /api/products/:id/images/:imgId - farmer only
router.delete('/:id/images/:imgId', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can delete images', 'forbidden');

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

  const image = db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(req.params.imgId, req.params.id);
  if (!image) return err(res, 404, 'Image not found', 'not_found');

  db.prepare('DELETE FROM product_images WHERE id = ?').run(req.params.imgId);

  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '../../uploads', path.basename(image.url));
  try { fs.unlinkSync(filePath); } catch {}

  const first = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(req.params.id);
  db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(first?.url ?? null, req.params.id);
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

// PATCH /api/products/:id/images/reorder - update sort_order for all images
router.patch('/:id/images/reorder', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can reorder images', 'forbidden');

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');
// PATCH /api/products/:id/images/reorder
router.patch('/:id/images/reorder', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can reorder images', 'forbidden');

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Product not found or not yours', 'not_found');

  const { order } = req.body;
  if (!Array.isArray(order)) return err(res, 400, 'order must be an array', 'validation_error');

  const update = db.prepare('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?');
  db.transaction((items) => {
    items.forEach(({ id, sort_order }) => update.run(sort_order, id, req.params.id));
  })(order);

  const first = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(req.params.id);
  if (first) db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(first.url, req.params.id);

  const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(req.params.id);
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

// GET /api/products/:id/carbon - Calculate carbon footprint
router.get('/:id/carbon', async (req, res) => {
  const { lat, lng } = req.query;
  
  const { rows } = await db.query(
    `SELECT p.*, u.location, u.name as farmer_name
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     WHERE p.id = $1`,
    [req.params.id]
  );
  
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  
  const product = rows[0];
  const { estimateCarbonFootprint } = require('../utils/carbon');
  
  // Simple distance calculation if coordinates provided
  let distanceKm = 0;
  if (lat && lng && product.location) {
    // Parse location if it contains coordinates (simplified)
    const locMatch = product.location.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
    if (locMatch) {
      const { calculateDistance } = require('../utils/carbon');
      distanceKm = calculateDistance(parseFloat(lat), parseFloat(lng), parseFloat(locMatch[1]), parseFloat(locMatch[2]));
    }
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
// GET /api/products/:id/tiers - get price tiers for a product
router.get('/:id/tiers', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, min_quantity, price_per_unit FROM price_tiers WHERE product_id = $1 ORDER BY min_quantity ASC',
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/products/:id/tiers - add/update price tiers (farmer only)
router.post('/:id/tiers', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can manage price tiers', 'forbidden');

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Product not found or not yours', 'not_found');

  const { tiers } = req.body;
  if (!Array.isArray(tiers)) return err(res, 400, 'tiers must be an array', 'validation_error');

  // Validate tiers
  const sortedTiers = tiers.sort((a, b) => a.min_quantity - b.min_quantity);
  for (let i = 0; i < sortedTiers.length; i++) {
    const tier = sortedTiers[i];
    if (!tier.min_quantity || tier.min_quantity < 1 || !Number.isInteger(tier.min_quantity)) {
      return err(res, 400, 'min_quantity must be a positive integer', 'validation_error');
    }
    if (!tier.price_per_unit || tier.price_per_unit <= 0) {
      return err(res, 400, 'price_per_unit must be a positive number', 'validation_error');
    }
    if (i > 0 && tier.min_quantity <= sortedTiers[i-1].min_quantity) {
      return err(res, 400, 'min_quantity values must be increasing', 'validation_error');
    }
  }

  // Delete existing tiers and insert new ones
  await db.query('DELETE FROM price_tiers WHERE product_id = $1', [req.params.id]);
  for (const tier of sortedTiers) {
    await db.query(
      'INSERT INTO price_tiers (product_id, min_quantity, price_per_unit) VALUES ($1, $2, $3)',
      [req.params.id, tier.min_quantity, tier.price_per_unit]
    );
  }

  const { rows: newTiers } = await db.query(
    'SELECT id, min_quantity, price_per_unit FROM price_tiers WHERE product_id = $1 ORDER BY min_quantity ASC',
    [req.params.id]
  );
  res.json({ success: true, data: newTiers });
});

module.exports = router;
