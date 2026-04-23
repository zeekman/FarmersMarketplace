const router = require('express').Router();
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const {
  VAPID_PUBLIC_KEY,
  savePushSubscription,
  deletePushSubscription,
  isConfigured,
} = require('../utils/pushNotifications');

router.get('/vapid-public-key', (_req, res) => {
  if (!isConfigured()) {
    return err(res, 503, 'Web Push is not configured', 'push_not_configured');
  }
  res.json({ success: true, data: { publicKey: VAPID_PUBLIC_KEY } });
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
    await savePushSubscription(req.user.id, subscription);
    res.status(201).json({ success: true, message: 'Push subscription saved' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'push_subscribe_failed' });
  }
});

router.delete('/subscribe', auth, async (req, res) => {
  try {
    await deletePushSubscription(req.user.id);
    res.json({ success: true, message: 'Push subscription removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, code: 'push_unsubscribe_failed' });
  }
});

module.exports = router;
