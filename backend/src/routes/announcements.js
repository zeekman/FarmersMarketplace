const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// GET /api/announcements — public, returns active non-expired announcements
router.get('/', async (_req, res) => {
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `SELECT id, message, type, created_at, expires_at FROM announcements
     WHERE active = 1 AND (expires_at IS NULL OR expires_at > $1)
     ORDER BY created_at DESC`,
    [now],
  );
  res.json({ success: true, data: rows });
});

// All routes below are admin-only
router.use(auth, adminAuth);

// GET /api/announcements/admin — all announcements (including inactive/expired)
router.get('/admin', async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');
  res.json({ success: true, data: rows });
});

// POST /api/announcements/admin
router.post('/admin', async (req, res) => {
  const { message, type = 'info', active = 1, expires_at } = req.body;
  if (!message?.trim()) return res.status(400).json({ success: false, error: 'message is required' });
  if (!['info', 'warning', 'error'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be info, warning, or error' });
  }
  const { rows } = await db.query(
    `INSERT INTO announcements (message, type, active, expires_at) VALUES ($1,$2,$3,$4) RETURNING *`,
    [message.trim(), type, active ? 1 : 0, expires_at || null],
  );
  res.status(201).json({ success: true, data: rows[0] });
});

// PATCH /api/announcements/admin/:id
router.patch('/admin/:id', async (req, res) => {
  const { rows: existing } = await db.query('SELECT id FROM announcements WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ success: false, error: 'Announcement not found' });

  const { message, type, active, expires_at } = req.body;
  const fields = [];
  const params = [];
  if (message !== undefined) { fields.push(`message = $${params.length + 1}`); params.push(message.trim()); }
  if (type !== undefined) {
    if (!['info', 'warning', 'error'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type must be info, warning, or error' });
    }
    fields.push(`type = $${params.length + 1}`); params.push(type);
  }
  if (active !== undefined) { fields.push(`active = $${params.length + 1}`); params.push(active ? 1 : 0); }
  if (expires_at !== undefined) { fields.push(`expires_at = $${params.length + 1}`); params.push(expires_at || null); }

  if (!fields.length) return res.status(400).json({ success: false, error: 'No fields to update' });

  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE announcements SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  res.json({ success: true, data: rows[0] });
});

// DELETE /api/announcements/admin/:id
router.delete('/admin/:id', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ success: false, error: 'Announcement not found' });
  res.json({ success: true, message: 'Deleted' });
});

module.exports = router;
