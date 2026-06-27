const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');

// POST /api/alerts/favourites/:productId — add to favourites
router.post('/favourites/:productId', auth, (req, res) => {
  try {
    db.prepare('INSERT OR IGNORE INTO favourites (user_id, product_id) VALUES (?, ?)').run(req.user.id, req.params.productId);
    res.json({ message: 'Added to favourites' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/alerts/favourites/:productId — remove from favourites
router.delete('/favourites/:productId', auth, (req, res) => {
  db.prepare('DELETE FROM favourites WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
  res.json({ message: 'Removed from favourites' });
});

// GET /api/alerts/favourites — list user's favourites
router.get('/favourites', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.* FROM favourites f JOIN products p ON f.product_id = p.id WHERE f.user_id = ?
  `).all(req.user.id);
  res.json(rows);
});

// POST /api/alerts/waitlist/:productId — join waitlist
router.post('/waitlist/:productId', auth, (req, res) => {
  try {
    db.prepare('INSERT OR IGNORE INTO waitlists (user_id, product_id) VALUES (?, ?)').run(req.user.id, req.params.productId);
    res.json({ message: 'Joined waitlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/alerts/waitlist/:productId — leave waitlist
router.delete('/waitlist/:productId', auth, (req, res) => {
  db.prepare('DELETE FROM waitlists WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
  res.json({ message: 'Left waitlist' });
});

// POST /api/alerts/push-subscription — save/update push subscription
router.post('/push-subscription', auth, (req, res) => {
  const { endpoint, subscription } = req.body;
  if (!endpoint || !subscription) return res.status(400).json({ error: 'endpoint and subscription required' });
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET endpoint = excluded.endpoint, subscription_json = excluded.subscription_json
  `).run(req.user.id, endpoint, JSON.stringify(subscription));
  res.json({ message: 'Push subscription saved' });
});

module.exports = router;
