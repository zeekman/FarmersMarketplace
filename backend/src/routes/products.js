const path = require('path');
const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');

// GET /api/products - public browse with optional filters
router.get('/', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const { category, minPrice, maxPrice, seller, available = 'true' } = req.query;

  const conditions = [];
  const countParams = [];
  const dataParams  = [];

  if (available === 'true') conditions.push('p.quantity > 0');

  if (category) {
    conditions.push('p.category = ?');
    countParams.push(category); dataParams.push(category);
  }
  if (minPrice !== undefined) {
    const min = parseFloat(minPrice);
    if (!isNaN(min)) { conditions.push('p.price >= ?'); countParams.push(min); dataParams.push(min); }
  }
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!isNaN(max)) { conditions.push('p.price <= ?'); countParams.push(max); dataParams.push(max); }
  }
  if (seller) {
    conditions.push('u.name LIKE ?');
    countParams.push(`%${seller}%`); dataParams.push(`%${seller}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`
  ).get(...countParams).count;

  const products = db.prepare(
    `SELECT p.*, u.name as farmer_name
     FROM products p JOIN users u ON p.farmer_id = u.id
     ${where}
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).all(...dataParams, limit, offset);

  res.json({ success: true, data: products, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
});

// GET /api/products/search?q=tomato - FTS5 full-text search
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    // Empty query returns all products
    const products = db.prepare(
      `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC LIMIT 100`
    ).all();
    return res.json({ success: true, data: products });
  }
  try {
    const products = db.prepare(`
      SELECT p.*, u.name as farmer_name, fts.rank
      FROM products_fts fts
      JOIN products p ON p.id = fts.rowid
      JOIN users u ON p.farmer_id = u.id
      WHERE products_fts MATCH ?
      ORDER BY fts.rank
      LIMIT 100
    `).all(q);
    res.json({ success: true, data: products });
  } catch {
    // Fallback to LIKE search if FTS fails (e.g. special chars)
    const like = `%${q}%`;
    const products = db.prepare(
      `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id
       WHERE p.name LIKE ? OR p.description LIKE ? ORDER BY p.created_at DESC LIMIT 100`
    ).all(like, like);
    res.json({ success: true, data: products });
  }
});

// GET /api/products/categories
router.get('/categories', (_req, res) => {
  const rows = db.prepare(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category`).all();
  res.json({ success: true, data: rows.map(r => r.category) });
});

// GET /api/products/mine/list - farmer's own products (must be before /:id)
router.get('/mine/list', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  res.json({ success: true, data: db.prepare('SELECT * FROM products WHERE farmer_id = ? ORDER BY created_at DESC').all(req.user.id) });
});

// POST /api/products/upload-image - upload a product image (farmer only, before listing)
router.post('/upload-image', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can upload images', 'forbidden');

  upload.single('image')(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') return err(res, 400, 'Image must be 5 MB or smaller', 'file_too_large');
      if (uploadErr.code === 'INVALID_TYPE')    return err(res, 400, uploadErr.message, 'invalid_file_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.file) return err(res, 400, 'No image file provided', 'no_file');

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl });
  });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, u.name as farmer_name, u.stellar_public_key as farmer_wallet
    FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = ?
  `).get(req.params.id);
  if (!product) return err(res, 404, 'Product not found', 'not_found');
  res.json({ success: true, data: product });
});

// POST /api/products - farmer only
router.post('/', auth, validate.product, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can list products', 'forbidden');

  const { name, description, unit, category, image_url } = req.body;
  const price    = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim())           return err(res, 400, 'Product name is required', 'validation_error');
  if (isNaN(price)    || price <= 0)   return err(res, 400, 'Price must be a positive number', 'validation_error');
  if (isNaN(quantity) || quantity < 1) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  // Validate image_url if provided — must be a known upload path
  const safeImageUrl = (image_url && /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(image_url))
    ? image_url
    : null;

  const result = db.prepare(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), description || '', category || 'other', price, quantity, unit || 'unit', safeImageUrl);

  res.json({ success: true, id: result.lastInsertRowid, message: 'Product listed' });
});

// DELETE /api/products/:id
router.delete('/:id', auth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Not found or not yours', 'not_found');
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Deleted' });
});

module.exports = router;
