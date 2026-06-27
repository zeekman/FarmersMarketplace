const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendBackInStockEmail, sendPushToUser } = require('../utils/mailer');

// GET /api/products - public browse with optional filters
// Query params: category, minPrice, maxPrice, seller (farmer name), available (default true)
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
    data: products,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
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
router.post('/', auth, validate.product, (req, res) => {
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

// POST /api/products/:id/restock — farmer adds stock; triggers back-in-stock notifications (once per restock)
router.post('/:id/restock', auth, (req, res) => {
  if (req.user.role !== 'farmer') return res.status(403).json({ error: 'Farmers only' });

  const quantity = parseInt(req.body.quantity, 10);
  if (isNaN(quantity) || quantity < 1) return res.status(400).json({ error: 'quantity must be a positive integer' });

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: 'Not found or not yours' });

  const wasOutOfStock = product.quantity === 0;
  db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, product.id);

  // Only notify if the product was out of stock and hasn't fired a notification for this restock yet.
  if (!wasOutOfStock || product.restock_notified_at) {
    return res.json({ message: 'Restocked', quantity: product.quantity + quantity });
  }

  // Stamp immediately to prevent duplicate sends on concurrent requests.
  db.prepare('UPDATE products SET restock_notified_at = CURRENT_TIMESTAMP WHERE id = ?').run(product.id);

  // Gather unique buyer IDs from both favourites and waitlists.
  const buyerIds = [
    ...db.prepare('SELECT user_id FROM favourites WHERE product_id = ?').all(product.id),
    ...db.prepare('SELECT user_id FROM waitlists WHERE product_id = ?').all(product.id),
  ]
    .map(r => r.user_id)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (buyerIds.length === 0) return res.json({ message: 'Restocked', notified: 0 });

  const updatedProduct = { ...product, quantity: product.quantity + quantity };

  // Fire-and-forget — don't block the HTTP response.
  Promise.allSettled(
    buyerIds.map(async (userId) => {
      const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
      if (!user) return;

      const sub = db.prepare('SELECT subscription_json FROM push_subscriptions WHERE user_id = ?').get(userId);

      await Promise.allSettled([
        sendBackInStockEmail({ user, product: updatedProduct }),
        sendPushToUser({
          subscription: sub ? JSON.parse(sub.subscription_json) : null,
          payload: {
            title: 'Back in stock',
            body: `${updatedProduct.name} is available again!`,
            url: `/products/${updatedProduct.id}`,
          },
        }),
      ]);
    })
  ).catch(err => console.error('Restock notification error:', err.message));

  res.json({ message: 'Restocked', notified: buyerIds.length });
});

module.exports = router;
