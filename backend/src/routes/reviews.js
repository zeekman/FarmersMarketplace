const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// Schema migrations for reviews
db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    body TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    UNIQUE(buyer_id, product_id)
  );
`);
// Ensure avg_rating and review_count exist on products
try { db.exec(`ALTER TABLE products ADD COLUMN avg_rating REAL DEFAULT 0`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE products ADD COLUMN review_count INTEGER DEFAULT 0`); } catch { /* column may already exist */ }

function recalcRating(productId) {
  const row = db.prepare(`
    SELECT ROUND(AVG(rating), 2) as avg, COUNT(*) as cnt
    FROM reviews WHERE product_id = ? AND status = 'approved'
  `).get(productId);
  db.prepare('UPDATE products SET avg_rating = ?, review_count = ? WHERE id = ?')
    .run(row.avg || 0, row.cnt || 0, productId);
}

// GET /api/reviews/:productId - approved reviews only (public)
router.get('/:productId', (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.rating, r.body, r.created_at, u.name as buyer_name
    FROM reviews r JOIN users u ON r.buyer_id = u.id
    WHERE r.product_id = ? AND r.status = 'approved'
    ORDER BY r.created_at DESC
  `).all(req.params.productId);
  res.json({ success: true, data: rows });
});

// PATCH /api/admin/reviews/:id/approve - admin moderation
router.patch('/admin/reviews/:id/approve', auth, (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admins only', 'forbidden');
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) return err(res, 404, 'Review not found', 'not_found');

  db.prepare("UPDATE reviews SET status = 'approved' WHERE id = ?").run(req.params.id);
  recalcRating(review.product_id);
  res.json({ success: true, message: 'Review approved' });
});

// PATCH /api/admin/reviews/:id/reject - admin moderation
router.patch('/admin/reviews/:id/reject', auth, (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admins only', 'forbidden');
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) return err(res, 404, 'Review not found', 'not_found');

  db.prepare("UPDATE reviews SET status = 'rejected' WHERE id = ?").run(req.params.id);
  recalcRating(review.product_id);
  res.json({ success: true, message: 'Review rejected' });
});

// GET /api/admin/reviews/pending - list pending reviews for admin
router.get('/admin/reviews/pending', auth, (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admins only', 'forbidden');
  const rows = db.prepare(`
    SELECT r.*, u.name as buyer_name, p.name as product_name
    FROM reviews r
    JOIN users u ON r.buyer_id = u.id
    JOIN products p ON r.product_id = p.id
    WHERE r.status = 'pending'
    ORDER BY r.created_at ASC
  `).all();
  res.json({ success: true, data: rows });
});

// DELETE /api/reviews/:id - buyer deletes own review
router.delete('/:id', auth, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ? AND buyer_id = ?').get(req.params.id, req.user.id);
  if (!review) return err(res, 404, 'Review not found or not yours', 'not_found');
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  recalcRating(review.product_id);
  res.json({ success: true, message: 'Review deleted' });
});

const validate = require('../middleware/validate');
const { sanitizeText } = require('../utils/sanitize');

// POST /api/reviews
router.post('/', auth, validate.review, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can submit reviews', 'forbidden');

  const product_id = parseInt(req.body.product_id, 10);
  const rating = parseInt(req.body.rating, 10);
  const comment = req.body.comment ? sanitizeText(req.body.comment) : null;

  // Check if buyer has a paid order for this product
  const { rows: orderRows } = await db.query(
    `SELECT id FROM orders WHERE buyer_id = $1 AND product_id = $2 AND status = 'paid' LIMIT 1`,
    [req.user.id, product_id]
  );
  if (!orderRows[0])
    return err(res, 403, 'Purchase required to review this product', 'purchase_required');

  const { rows } = await db.query(
    'INSERT INTO reviews (order_id, buyer_id, product_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [orderRows[0].id, req.user.id, product_id, rating, comment]
  );
  res.status(201).json({ success: true, id: rows[0].id, message: 'Review submitted' });
});

// GET /api/products/:id/reviews
router.get('/products/:id/reviews', async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name as reviewer_name
     FROM reviews r JOIN users u ON r.buyer_id = u.id
     WHERE r.product_id = $1 ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

module.exports = router;
