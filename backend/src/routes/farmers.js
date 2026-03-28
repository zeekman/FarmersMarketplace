const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');

const PUBLIC_FIELDS = 'u.id, u.name, u.bio, u.location, u.avatar_url, u.created_at, u.latitude, u.longitude, u.farm_address';

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

  const { bio, location, avatar_url, federation_name, latitude, longitude, farm_address } = req.body;
  const updates = [];
  const params = [];

  if (bio !== undefined)          { updates.push(`bio = $${params.length + 1}`);           params.push(bio ? sanitizeText(bio) : null); }
  if (location !== undefined)     { updates.push(`location = $${params.length + 1}`);       params.push(location ? sanitizeText(location) : null); }
  if (avatar_url !== undefined)   { updates.push(`avatar_url = $${params.length + 1}`);     params.push(avatar_url || null); }
  if (farm_address !== undefined) { updates.push(`farm_address = $${params.length + 1}`);   params.push(farm_address ? sanitizeText(farm_address) : null); }
  if (latitude !== undefined) {
    const lat = latitude === null ? null : parseFloat(latitude);
    if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) return err(res, 400, 'Invalid latitude', 'validation_error');
    updates.push(`latitude = $${params.length + 1}`);
    params.push(lat);
  }
  if (longitude !== undefined) {
    const lng = longitude === null ? null : parseFloat(longitude);
    if (lng !== null && (isNaN(lng) || lng < -180 || lng > 180)) return err(res, 400, 'Invalid longitude', 'validation_error');
    updates.push(`longitude = $${params.length + 1}`);
    params.push(lng);
  }
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

// POST /api/farmers/verify - Submit verification documents
router.post('/verify', auth, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Only farmers can submit verification', 'forbidden');
  }

  const { document_urls } = req.body;
  if (!document_urls || !Array.isArray(document_urls) || document_urls.length === 0) {
    return err(res, 400, 'document_urls array is required', 'validation_error');
  }

  // Store as JSON string
  const docsJson = JSON.stringify(document_urls);

  await db.query(
    'UPDATE users SET verification_status = $1, verification_docs = $2 WHERE id = $3',
    ['pending', docsJson, req.user.id]
  );

  res.json({ success: true, message: 'Verification submitted for review' });
});

module.exports = router;
