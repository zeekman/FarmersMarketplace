const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// GET /api/addresses
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');
  const { rows } = await db.query(
    'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
    [req.user.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/addresses
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');
  const { label, street, city, country, postal_code, is_default } = req.body;
  if (!label || !street || !city || !country)
    return err(res, 400, 'label, street, city, and country are required', 'validation_error');

  if (is_default)
    await db.query('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [req.user.id]);

  const { rows } = await db.query(
    'INSERT INTO addresses (user_id, label, street, city, country, postal_code, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [
      req.user.id,
      label.trim(),
      street.trim(),
      city.trim(),
      country.trim(),
      postal_code?.trim() || null,
      is_default ? 1 : 0,
    ]
  );
  const { rows: addr } = await db.query('SELECT * FROM addresses WHERE id = $1', [rows[0].id]);
  res.status(201).json({ success: true, data: addr[0] });
});

// PUT /api/addresses/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');
  const { label, street, city, country, postal_code, is_default } = req.body;
  if (!label || !street || !city || !country)
    return err(res, 400, 'label, street, city, and country are required', 'validation_error');

  const { rows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  if (!rows[0]) return err(res, 404, 'Address not found', 'not_found');

  if (is_default)
    await db.query('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [req.user.id]);

  await db.query(
    'UPDATE addresses SET label=$1, street=$2, city=$3, country=$4, postal_code=$5, is_default=$6 WHERE id=$7',
    [
      label.trim(),
      street.trim(),
      city.trim(),
      country.trim(),
      postal_code?.trim() || null,
      is_default ? 1 : 0,
      req.params.id,
    ]
  );
  const { rows: addr } = await db.query('SELECT * FROM addresses WHERE id = $1', [req.params.id]);
  res.json({ success: true, data: addr[0] });
});

// PATCH /api/addresses/:id/default
router.patch('/:id/default', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');
  const { rows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  if (!rows[0]) return err(res, 404, 'Address not found', 'not_found');

  await db.query('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [req.user.id]);
  await db.query('UPDATE addresses SET is_default = 1 WHERE id = $1', [req.params.id]);

  const { rows: addr } = await db.query('SELECT * FROM addresses WHERE id = $1', [req.params.id]);
  res.json({ success: true, data: addr[0] });
});

// DELETE /api/addresses/:id
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');
  const { rows } = await db.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  if (!rows[0]) return err(res, 404, 'Address not found', 'not_found');

  const { rows: orderRows } = await db.query(
    'SELECT COUNT(*) as count FROM orders WHERE address_id = $1',
    [req.params.id]
  );
  if (parseInt(orderRows[0].count) > 0)
    return err(res, 400, 'Cannot delete address that has been used in orders', 'address_in_use');

  await db.query('DELETE FROM addresses WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Address deleted' });
});

module.exports = router;
