const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

// POST /api/reviews - buyer submits a review for a paid order
router.post('/', auth, validate.review, (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can submit reviews', 'forbidden');

  const order_id = parseInt(req.body.order_id, 10);
  const rating = parseInt(req.body.rating, 10);
  const comment = req.body.comment || null;

  // Verify the order exists, belongs to this buyer, and is paid
  const order = db
    .prepare(`SELECT * FROM orders WHERE id = ? AND buyer_id = ? AND status = 'paid'`)
    .get(order_id, req.user.id);

  if (!order)
    return err(res, 403, 'You can only review products from your paid orders', 'forbidden');

  // Enforce one-review-per-order
  const existing = db.prepare('SELECT id FROM reviews WHERE order_id = ?').get(order_id);
  if (existing)
    return res
      .status(409)
      .json({
        success: false,
        message: 'You have already reviewed this order',
        code: 'duplicate_review',
      });

  const result = db
    .prepare(
      'INSERT INTO reviews (order_id, buyer_id, product_id, rating, comment) VALUES (?, ?, ?, ?, ?)'
    )
    .run(order_id, req.user.id, order.product_id, rating, comment);

  res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Review submitted' });
});

// GET /api/products/:id/reviews - public, returns all reviews for a product
router.get('/products/:id/reviews', (req, res) => {
  const reviews = db
    .prepare(
      `
    SELECT r.id, r.rating, r.comment, r.created_at,
           u.name as reviewer_name
    FROM reviews r
    JOIN users u ON r.buyer_id = u.id
    WHERE r.product_id = ?
    ORDER BY r.created_at DESC
  `
    )
    .all(req.params.id);

  res.json({ success: true, data: reviews });
});

module.exports = router;
