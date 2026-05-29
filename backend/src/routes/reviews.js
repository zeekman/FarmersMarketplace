const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');
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
