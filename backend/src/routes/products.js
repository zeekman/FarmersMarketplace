const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');

// GET /api/products - public browse with optional filters
// Query params: category, minPrice, maxPrice, seller (farmer name), available (default true)
router.get('/', (req, res) => {
  const { category, minPrice, maxPrice, seller, available = 'true' } = req.query;

  let sql = `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id WHERE 1=1`;
  const params = [];

  if (available === 'true') { sql += ` AND p.quantity > 0`; }
  if (category)  { sql += ` AND p.category = ?`;              params.push(category); }
  if (minPrice)  { sql += ` AND p.price >= ?`;                params.push(parseFloat(minPrice)); }
  if (maxPrice)  { sql += ` AND p.price <= ?`;                params.push(parseFloat(maxPrice)); }
  if (seller)    { sql += ` AND u.name LIKE ?`;               params.push(`%${seller}%`); }

  sql += ` ORDER BY p.created_at DESC`;

  res.json(db.prepare(sql).all(...params));
});

// GET /api/products/categories - list distinct categories
router.get('/categories', (req, res) => {
  const rows = db.prepare(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category`).all();
  res.json(rows.map(r => r.category));
});

// GET /api/products/mine/list - farmer's own products (must be before /:id)
router.get('/mine/list', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return res.status(403).json({ error: 'Farmers only' });
  res.json(db.prepare('SELECT * FROM products WHERE farmer_id = ? ORDER BY created_at DESC').all(req.user.id));
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, u.name as farmer_name, u.stellar_public_key as farmer_wallet
    FROM products p JOIN users u ON p.farmer_id = u.id WHERE p.id = ?
  `).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// POST /api/products - farmer only
router.post('/', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return res.status(403).json({ error: 'Only farmers can list products' });

  const { name, description, unit, category } = req.body;
  const price    = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim())          return res.status(400).json({ error: 'Product name is required' });
  if (isNaN(price)    || price <= 0)  return res.status(400).json({ error: 'Price must be a positive number' });
  if (isNaN(quantity) || quantity < 1) return res.status(400).json({ error: 'Quantity must be a positive integer' });

  const result = db.prepare(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), description || '', category || 'other', price, quantity, unit || 'unit');

  res.json({ id: result.lastInsertRowid, message: 'Product listed' });
});

// DELETE /api/products/:id
router.delete('/:id', auth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: 'Not found or not yours' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
