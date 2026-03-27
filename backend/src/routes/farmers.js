const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

// Safe public fields — never expose password, stellar_secret_key, email
const PUBLIC_FIELDS = 'u.id, u.name, u.bio, u.location, u.avatar_url, u.created_at';

// GET /api/farmers/:id — public farmer profile with active listings
router.get('/:id', (req, res) => {
  const farmer = db.prepare(
    `SELECT ${PUBLIC_FIELDS} FROM users u WHERE u.id = ? AND u.role = 'farmer'`
  ).get(req.params.id);

  if (!farmer) return err(res, 404, 'Farmer not found', 'not_found');

  const listings = db.prepare(
    `SELECT id, name, description, category, price, quantity, unit, image_url, created_at
     FROM products WHERE farmer_id = ? AND quantity > 0 ORDER BY created_at DESC`
  ).all(req.params.id);

  res.json({ success: true, data: { ...farmer, listings } });
});

// PATCH /api/farmers/me — authenticated farmer updates their own profile
router.patch('/me', auth, validate.farmerProfile, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can update a farmer profile', 'forbidden');

  const { bio, location, avatar_url } = req.body;

  // Build SET clause dynamically — only update provided fields
  const updates = [];
  const params  = [];

  if (bio !== undefined)        { updates.push('bio = ?');        params.push(bio || null); }
  if (location !== undefined)   { updates.push('location = ?');   params.push(location || null); }
  if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url || null); }

  if (updates.length === 0)
    return res.status(400).json({ success: false, message: 'No fields to update', code: 'no_changes' });

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(
    `SELECT ${PUBLIC_FIELDS} FROM users u WHERE u.id = ?`
  ).get(req.user.id);

  res.json({ success: true, data: updated });
});

module.exports = router;
