const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// GET /api/farmers/me/bundle-discounts
router.get('/me/bundle-discounts', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { rows } = await db.query(
    'SELECT * FROM bundle_discounts WHERE farmer_id = $1 ORDER BY min_products ASC',
    [req.user.id],
  );
  res.json({ success: true, data: rows });
});

// POST /api/farmers/me/bundle-discounts
router.post('/me/bundle-discounts', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { min_products, discount_percent } = req.body;
  if (!Number.isInteger(min_products) || min_products < 2) {
    return err(res, 400, 'min_products must be an integer >= 2', 'validation_error');
  }
  if (typeof discount_percent !== 'number' || discount_percent <= 0 || discount_percent > 100) {
    return err(res, 400, 'discount_percent must be between 0 and 100', 'validation_error');
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO bundle_discounts (farmer_id, min_products, discount_percent)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, min_products, discount_percent],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505' || e.message?.includes('UNIQUE')) {
      return err(res, 409, 'A discount tier for that min_products already exists', 'duplicate');
    }
    throw e;
  }
});

// PUT /api/farmers/me/bundle-discounts/:id
router.put('/me/bundle-discounts/:id', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { min_products, discount_percent } = req.body;
  if (!Number.isInteger(min_products) || min_products < 2) {
    return err(res, 400, 'min_products must be an integer >= 2', 'validation_error');
  }
  if (typeof discount_percent !== 'number' || discount_percent <= 0 || discount_percent > 100) {
    return err(res, 400, 'discount_percent must be between 0 and 100', 'validation_error');
  }
  const { rowCount, rows } = await db.query(
    `UPDATE bundle_discounts SET min_products = $1, discount_percent = $2
     WHERE id = $3 AND farmer_id = $4 RETURNING *`,
    [min_products, discount_percent, req.params.id, req.user.id],
  );
  if (!rowCount) return err(res, 404, 'Discount tier not found', 'not_found');
  res.json({ success: true, data: rows[0] });
});

// DELETE /api/farmers/me/bundle-discounts/:id
router.delete('/me/bundle-discounts/:id', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { rowCount } = await db.query(
    'DELETE FROM bundle_discounts WHERE id = $1 AND farmer_id = $2',
    [req.params.id, req.user.id],
  );
  if (!rowCount) return err(res, 404, 'Discount tier not found', 'not_found');
  res.json({ success: true });
});

module.exports = router;
