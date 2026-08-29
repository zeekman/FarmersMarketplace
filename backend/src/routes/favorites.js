const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// POST /api/favorites
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can add favorites', 'forbidden');
  const { product_id } = req.body;
  if (!product_id) return err(res, 400, 'Product ID is required', 'validation_error');

  const { rows } = await db.query('SELECT id FROM products WHERE id = $1', [product_id]);
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');

  try {
    await db.query('INSERT INTO favorites (buyer_id, product_id) VALUES ($1, $2)', [
      req.user.id,
      product_id,
    ]);
    res.json({ success: true, message: 'Added to favorites' });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.code === '23505')
      return err(res, 409, 'Already in favorites', 'already_favorited');
    return err(res, 500, 'Failed to add favorite', 'database_error');
  }
});

// DELETE /api/favorites/:product_id
router.delete('/:product_id', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can remove favorites', 'forbidden');
  const { rowCount } = await db.query(
    'DELETE FROM favorites WHERE buyer_id = $1 AND product_id = $2',
    [req.user.id, req.params.product_id]
  );
  if (rowCount === 0) return err(res, 404, 'Favorite not found', 'not_found');
  res.json({ success: true, message: 'Removed from favorites' });
});

// GET /api/favorites
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can view favorites', 'forbidden');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query(
    'SELECT COUNT(*) as count FROM favorites WHERE buyer_id = $1',
    [req.user.id]
  );
  const total = parseInt(countRows[0].count);

  const { rows: favorites } = await db.query(
    `SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar,
            ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count, f.created_at as favorited_at
     FROM favorites f
     JOIN products p ON f.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     WHERE f.buyer_id = $1
     GROUP BY p.id, u.id, f.created_at
     ORDER BY f.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );

  res.json({
    success: true,
    data: favorites,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// GET /api/favorites/check/:product_id
router.get('/check/:product_id', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can check favorites', 'forbidden');
  const { rows } = await db.query(
    'SELECT id FROM favorites WHERE buyer_id = $1 AND product_id = $2',
    [req.user.id, req.params.product_id]
  );
  res.json({ success: true, isFavorited: !!rows[0] });
});

module.exports = router;
