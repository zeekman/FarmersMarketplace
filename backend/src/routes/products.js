const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

// GET /api/products - public browse with optional filters
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM products WHERE quantity > 0').get().count;
  const products = db.prepare(`
    SELECT p.*, u.name as farmer_name
    FROM products p
    JOIN users u ON p.farmer_id = u.id
    WHERE p.quantity > 0
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({
    success: true,
    data: products,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/products/categories
router.get('/categories', (req, res) => {
  const rows = db.prepare(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category`).all();
  res.json({ success: true, data: rows.map(r => r.category) });
});

// GET /api/products/mine/list - farmer's own products (must be before /:id)
router.get('/mine/list', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Farmers only', 'forbidden');
  res.json({ success: true, data: db.prepare('SELECT * FROM products WHERE farmer_id = ? ORDER BY created_at DESC').all(req.user.id) });
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
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can list products', 'forbidden');

  const { name, description, unit, category } = req.body;
  const price    = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim())           return err(res, 400, 'Product name is required', 'validation_error');
  if (isNaN(price)    || price <= 0)   return err(res, 400, 'Price must be a positive number', 'validation_error');
  if (isNaN(quantity) || quantity < 1) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  const result = db.prepare(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), description || '', category || 'other', price, quantity, unit || 'unit');

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
