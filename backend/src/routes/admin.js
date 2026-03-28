const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

router.use(auth, adminAuth);

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page || '1'));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM users');
  const total = parseInt(countRows[0].count);

  const { rows: users } = await db.query(
    'SELECT id, name, email, role, stellar_public_key, created_at, active FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  res.json({ success: true, data: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const { rows } = await db.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
  if (rows[0].role === 'admin') return res.status(400).json({ success: false, error: 'Cannot deactivate another admin' });
  await db.query('UPDATE users SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'User deactivated' });
});

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  const { rows: u } = await db.query('SELECT COUNT(*) as count FROM users');
  const { rows: p } = await db.query('SELECT COUNT(*) as count FROM products');
  const { rows: o } = await db.query('SELECT COUNT(*) as count FROM orders');
  const { rows: r } = await db.query(`SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = 'paid'`);
  res.json({ success: true, data: { users: parseInt(u[0].count), products: parseInt(p[0].count), orders: parseInt(o[0].count), total_revenue_xlm: r[0].total } });
});

module.exports = router;
