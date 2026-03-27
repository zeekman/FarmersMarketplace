const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// All admin routes require auth + admin role
router.use(auth, adminAuth);

// GET /api/admin/users - list all users (paginated)
router.get('/users', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const users = db.prepare(
    'SELECT id, name, email, role, stellar_public_key, created_at, active FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);

  res.json({ success: true, data: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// DELETE /api/admin/users/:id - deactivate a user
router.delete('/users/:id', (req, res) => {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ success: false, error: 'Cannot deactivate another admin' });

  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'User deactivated' });
});

// GET /api/admin/stats - platform-wide statistics
router.get('/stats', (req, res) => {
  const users    = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const products = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const orders   = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const revenue  = db.prepare("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = 'paid'").get().total;

  res.json({ success: true, data: { users, products, orders, total_revenue_xlm: revenue } });
});

module.exports = router;
