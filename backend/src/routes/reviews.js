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

  const order_id = parseInt(req.body.order_id, 10);
  const rating = parseInt(req.body.rating, 10);
  const comment = req.body.comment ? sanitizeText(req.body.comment) : null;

  const { rows: orderRows } = await db.query(
    `SELECT * FROM orders WHERE id = $1 AND buyer_id = $2 AND status = 'paid'`,
    [order_id, req.user.id]
  );
  if (!orderRows[0])
    return err(res, 403, 'You can only review products from your paid orders', 'forbidden');

  const { rows: existing } = await db.query('SELECT id FROM reviews WHERE order_id = $1', [
    order_id,
  ]);
  if (existing[0])
    return res
      .status(409)
      .json({
        success: false,
        message: 'You have already reviewed this order',
        code: 'duplicate_review',
      });

  const { rows } = await db.query(
    'INSERT INTO reviews (order_id, buyer_id, product_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [order_id, req.user.id, orderRows[0].product_id, rating, comment]
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
