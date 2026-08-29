const router = require('express').Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { err } = require('../middleware/error');
const db = require('../db/schema');
const push = require('../utils/pushNotifications');

router.get('/vapid-public-key', (_req, res) => {
  if (!push.isConfigured()) {
    return err(res, 503, 'Web Push is not configured', 'push_not_configured');
  }
  res.json({ success: true, data: { publicKey: push.VAPID_PUBLIC_KEY } });
});

router.get('/history', auth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) as count FROM push_notification_history WHERE user_id = $1',
      [req.user.id]
    );
    const total = parseInt(countRows[0]?.count || 0, 10);
    const { rows: data } = await db.query(
      `SELECT id, title, body, status, error, created_at
       FROM push_notification_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'notification_history_error' });
  }
});

router.post('/subscribe', auth, async (req, res) => {
  const { subscription } = req.body || {};
  if (
    !subscription ||
    !subscription.endpoint ||
    !subscription.keys?.p256dh ||
    !subscription.keys?.auth
  ) {
    return err(res, 400, 'Invalid push subscription payload', 'validation_error');
  }

  try {
    await push.savePushSubscription(req.user.id, subscription);
    res.status(201).json({ success: true, message: 'Push subscription saved' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'push_subscribe_failed' });
  }
});

router.delete('/subscribe', auth, async (req, res) => {
  try {
    await push.deletePushSubscription(req.user.id);
    res.json({ success: true, message: 'Push subscription removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'push_unsubscribe_failed' });
  }
});

// POST /api/admin/rotate-vapid-keys — admin: regenerate VAPID keys
// All existing push subscriptions become stale after rotation; subscribers must re-subscribe.
router.post('/admin/rotate-vapid-keys', adminAuth, async (req, res) => {
  try {
    const { publicKey } = await push.rotateVapidKeys();
    res.json({ success: true, message: 'VAPID keys rotated. All existing push subscriptions are now invalid.', publicKey });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'vapid_rotation_failed' });
  }
});

module.exports = router;
