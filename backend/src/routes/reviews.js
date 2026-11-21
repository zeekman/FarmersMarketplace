const express = require('express');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const validate = require('../middleware/validate');
const { sanitizeText } = require('../utils/sanitize');

const router = express.Router();
const adminRouter = express.Router();
const productRouter = express.Router();

async function recalcRating(productId) {
  const { rows } = await db.query(
    `SELECT ROUND(AVG(rating), 2) AS avg, COUNT(*) AS cnt
     FROM reviews WHERE product_id = $1 AND status = 'approved'`,
    [productId]
  );
  const row = rows[0];
  await db.query('UPDATE products SET avg_rating = $1, review_count = $2 WHERE id = $3', [
    row.avg || 0,
    row.cnt || 0,
    productId,
  ]);
}

// GET /api/reviews/:productId - approved reviews only (public, paginated)
router.get('/:productId', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) as count FROM reviews WHERE product_id = $1 AND status = $2',
      [req.params.productId, 'approved']
    );
    const total = parseInt(countRows[0]?.count || 0, 10);

    const { rows } = await db.query(
      `SELECT r.id, r.rating, r.comment AS body, r.created_at, u.name AS buyer_name
       FROM reviews r JOIN users u ON r.buyer_id = u.id
       WHERE r.product_id = $1 AND r.status = $2
       ORDER BY r.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.productId, 'approved', limit, offset]
    );

    res.json({ data: rows, page, limit, total });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'server_error' });
  }
});

adminRouter.patch('/:id/approve', auth, async (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admins only', 'forbidden');
  const { rows } = await db.query('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
  const review = rows[0];
  if (!review) return err(res, 404, 'Review not found', 'not_found');

  await db.query("UPDATE reviews SET status = 'approved' WHERE id = $1", [req.params.id]);
  await recalcRating(review.product_id);
  res.json({ success: true, message: 'Review approved' });
});

adminRouter.patch('/:id/reject', auth, async (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admins only', 'forbidden');
  const { rows } = await db.query('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
  const review = rows[0];
  if (!review) return err(res, 404, 'Review not found', 'not_found');

  await db.query("UPDATE reviews SET status = 'rejected' WHERE id = $1", [req.params.id]);
  await recalcRating(review.product_id);
  res.json({ success: true, message: 'Review rejected' });
});

// GET /api/admin/reviews/pending - list pending reviews for admin
adminRouter.get('/pending', auth, async (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admins only', 'forbidden');

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  try {
    const { rows: countRows } = await db.query(
      "SELECT COUNT(*) as count FROM reviews WHERE status = 'pending'"
    );
    const total = parseInt(countRows[0]?.count || 0, 10);

    const { rows } = await db.query(
      `SELECT r.*, u.name AS buyer_name, p.name AS product_name
       FROM reviews r
       JOIN users u ON r.buyer_id = u.id
       JOIN products p ON r.product_id = p.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({
      success: true,
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'server_error' });
  }
});

// DELETE /api/reviews/:id - buyer deletes own review
router.delete('/:id', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM reviews WHERE id = $1 AND buyer_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  const review = rows[0];
  if (!review) return err(res, 404, 'Review not found or not yours', 'not_found');

  await db.query('DELETE FROM reviews WHERE id = $1', [req.params.id]);
  await recalcRating(review.product_id);
  res.json({ success: true, message: 'Review deleted' });
});

// POST /api/reviews
router.post('/', auth, validate.review, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can submit reviews', 'forbidden');

  const orderId = Number(req.body.order_id);
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return err(res, 400, 'Rating must be an integer between 1 and 5', 'validation_error');
  const comment = req.body.comment ? sanitizeText(req.body.comment) : null;

  const { rows: orderRows } = await db.query(
    `SELECT id, product_id FROM orders
     WHERE buyer_id = $1 AND id = $2
       AND status IN ('paid', 'processing', 'shipped', 'delivered', 'completed')
     LIMIT 1`,
    [req.user.id, orderId]
  );
  if (!orderRows[0])
    return err(res, 403, 'Purchase required to review this product', 'purchase_required');

  const { rows: existingReviews } = await db.query(
    'SELECT id FROM reviews WHERE order_id = $1',
    [orderRows[0].id]
  );
  if (existingReviews[0])
    return err(res, 409, 'You have already reviewed this order', 'duplicate_review');

  const order = orderRows[0];
  const { rows } = await db.query(
    'INSERT INTO reviews (order_id, buyer_id, product_id, rating, comment) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [order.id, req.user.id, order.product_id, rating, comment]
  );
  res.status(201).json({ success: true, id: rows[0].id, message: 'Review submitted' });
});

productRouter.get('/:id/reviews', async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS reviewer_name
     FROM reviews r JOIN users u ON r.buyer_id = u.id
     WHERE r.product_id = $1 AND r.status = 'approved'
     ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

router.adminRouter = adminRouter;
router.productRouter = productRouter;

module.exports = router;
