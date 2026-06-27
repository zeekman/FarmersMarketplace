const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { anonymizeUser } = require('../jobs/anonymizeDeactivatedUsers');

// POST /api/admin/users/:id/anonymize — immediate GDPR erasure on request
router.post('/users/:id/anonymize', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

  const user = db.prepare('SELECT id, anonymized_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.anonymized_at) return res.status(409).json({ error: 'User already anonymized' });

  try {
    anonymizeUser(user.id);
    res.json({ message: 'User anonymized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
