const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');

const PUBLIC_FIELDS = 'u.id, u.name, u.bio, u.location, u.avatar_url, u.created_at';

// GET /api/farmers/:id
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_FIELDS} FROM users u WHERE u.id = $1 AND u.role = 'farmer'`,
    [req.params.id]
  );
  if (!rows[0]) return err(res, 404, 'Farmer not found', 'not_found');

  const { rows: listings } = await db.query(
    `SELECT id, name, description, category, price, quantity, unit, image_url, created_at
     FROM products WHERE farmer_id = $1 AND quantity > 0 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: { ...rows[0], listings } });
});

// PATCH /api/farmers/me
router.patch('/me', auth, validate.farmerProfile, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can update a farmer profile', 'forbidden');

  const { bio, location, avatar_url, federation_name } = req.body;
  const updates = [];
  const params = [];

  if (bio !== undefined)        { updates.push(`bio = $${params.length + 1}`);        params.push(bio ? sanitizeText(bio) : null); }
  if (location !== undefined)   { updates.push(`location = $${params.length + 1}`);   params.push(location ? sanitizeText(location) : null); }
  if (avatar_url !== undefined) { updates.push(`avatar_url = $${params.length + 1}`); params.push(avatar_url || null); }
  if (federation_name !== undefined) {
    const name = federation_name ? federation_name.toLowerCase().trim() : null;
    if (name && !/^[a-z0-9._-]{1,64}$/.test(name)) return err(res, 400, 'Federation name may only contain lowercase letters, numbers, dots, hyphens, underscores (max 64 chars)', 'validation_error');
    if (name) {
      const { rows } = await db.query('SELECT id FROM users WHERE federation_name = $1 AND id != $2', [name, req.user.id]);
      if (rows[0]) return err(res, 409, 'Federation name already taken', 'conflict');
    }
    updates.push(`federation_name = $${params.length + 1}`);
    params.push(name);
  }

  if (updates.length === 0) return res.status(400).json({ success: false, message: 'No fields to update', code: 'no_changes' });

  params.push(req.user.id);
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  const { rows } = await db.query(`SELECT ${PUBLIC_FIELDS}, federation_name FROM users u WHERE u.id = $1`, [req.user.id]);
  res.json({ success: true, data: rows[0] });
});

module.exports = router;
