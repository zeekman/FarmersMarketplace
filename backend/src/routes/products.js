const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const { sendBackInStockEmail } = require('../utils/mailer');

// GET /api/products - public browse with optional filters
router.get('/', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const { category, minPrice, maxPrice, seller, available = 'true' } = req.query;

  const conditions = [];
  const params = [];

  if (available === 'true') conditions.push('p.quantity > 0');
  if (category)   { conditions.push(`p.category = $${params.length + 1}`);        params.push(category); }
  if (minPrice !== undefined) { const min = parseFloat(minPrice); if (!isNaN(min)) { conditions.push(`p.price >= $${params.length + 1}`); params.push(min); } }
  if (maxPrice !== undefined) { const max = parseFloat(maxPrice); if (!isNaN(max)) { conditions.push(`p.price <= $${params.length + 1}`); params.push(max); } }
  if (seller)     { conditions.push(`u.name ILIKE $${params.length + 1}`);         params.push(`%${seller}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await db.query(
    `SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].count);

  const dataParams = [...params, limit, offset];
  const { rows: products } = await db.query(
    `SELECT p.*, u.name as farmer_name,
            ROUND(AVG(r.rating)::numeric, 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     ${where}
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
    res.json({ success: true, imageUrl: `/uploads/${req.file.filename}` });
  });
});

// GET /api/products/:id
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
  if (isNaN(quantity) || quantity <= 0) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  const product = rows[0];
  if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

  const wasOutOfStock = product.quantity === 0;
  await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, req.params.id]);

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
  res.json({ success: true, message: 'Restocked successfully' });
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

// POST /api/products
router.post('/', auth, validate.product, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can list products', 'forbidden');

  const { name, description, unit, category, image_url } = req.body;
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

  const { rows } = await db.query(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url, low_stock_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [req.user.id, safeName, safeDescription, safeCategory, price, quantity, safeUnit, safeImageUrl, parseInt(req.body.low_stock_threshold) || 5]
  );
  res.json({ success: true, id: rows[0].id, message: 'Product listed' });
});

// PATCH /api/products/:id
router.patch('/:id', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can edit products', 'forbidden');

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  const product = rows[0];
  if (!product) return err(res, 404, 'Not found or not yours', 'not_found');

  const allowed = ['name', 'description', 'price', 'quantity', 'unit', 'category', 'low_stock_threshold'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return err(res, 400, 'No valid fields to update', 'validation_error');

  if (updates.name !== undefined)        updates.name        = sanitizeText(updates.name);
  if (updates.description !== undefined) updates.description = sanitizeText(updates.description);
  if (updates.unit !== undefined)        updates.unit        = sanitizeText(updates.unit);
  if (updates.category !== undefined)    updates.category    = sanitizeText(updates.category);
  if (updates.price !== undefined) {
    updates.price = parseFloat(updates.price);
    if (isNaN(updates.price) || updates.price <= 0) return err(res, 400, 'Price must be a positive number', 'validation_error');
  }
  if (updates.quantity !== undefined) {
    updates.quantity = parseInt(updates.quantity, 10);
    if (isNaN(updates.quantity) || updates.quantity < 0) return err(res, 400, 'Quantity must be non-negative', 'validation_error');
  }
  if (updates.low_stock_threshold !== undefined) {
    updates.low_stock_threshold = parseInt(updates.low_stock_threshold, 10);
    if (isNaN(updates.low_stock_threshold) || updates.low_stock_threshold < 0) return err(res, 400, 'Threshold must be non-negative', 'validation_error');
  }

  const newQty       = updates.quantity ?? product.quantity;
  const newThreshold = updates.low_stock_threshold ?? product.low_stock_threshold ?? 5;
  if (newQty > newThreshold) updates.low_stock_alerted = 0;

  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(`UPDATE products SET ${setClauses} WHERE id = $${keys.length + 1}`, [...values, req.params.id]);

  res.json({ success: true, message: 'Product updated' });
});

// DELETE /api/products/:id
router.delete('/:id', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Not found or not yours', 'not_found');
  await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Deleted' });
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
    if (images.length > 0) {
      await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [images[0].url, req.params.id]);
    }
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

module.exports = router;
