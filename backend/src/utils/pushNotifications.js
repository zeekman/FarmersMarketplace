const webpush = require('web-push');
const db = require('../db/schema');

const VAPID_PUBLIC_KEY = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@farmersmarketplace.local';

function isConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

function configureWebPush() {
  if (!isConfigured()) return;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function ensurePushSubscriptionTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subscription TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`
  );
}

async function savePushSubscription(userId, subscription) {
  await ensurePushSubscriptionTable();
  const serialized = JSON.stringify(subscription);

  if (db.isPostgres) {
    await db.query(
      `INSERT INTO push_subscriptions (user_id, subscription, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = NOW()`,
      [userId, serialized]
    );
    return;
  }

  await db.query('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
  await db.query('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', [
    userId,
    serialized,
  ]);
}

async function deletePushSubscription(userId) {
  await ensurePushSubscriptionTable();
  if (db.isPostgres) {
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
    return;
  }
  await db.query('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
}

async function sendPushToUser(userId, payload) {
  if (!isConfigured()) return;
  configureWebPush();
  await ensurePushSubscriptionTable();

  const query = db.isPostgres
    ? 'SELECT id, subscription FROM push_subscriptions WHERE user_id = $1'
    : 'SELECT id, subscription FROM push_subscriptions WHERE user_id = ?';
  const { rows } = await db.query(query, [userId]);
  if (!rows[0]) return;

  try {
    await webpush.sendNotification(JSON.parse(rows[0].subscription), JSON.stringify(payload));
  } catch (e) {
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await deletePushSubscription(userId);
      return;
    }
    throw e;
  }
}

module.exports = {
  VAPID_PUBLIC_KEY,
  isConfigured,
  configureWebPush,
  ensurePushSubscriptionTable,
  savePushSubscription,
  deletePushSubscription,
  sendPushToUser,
};
