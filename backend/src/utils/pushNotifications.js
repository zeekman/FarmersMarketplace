const webpush = require('web-push');
const db = require('../db/schema');

// Mutable VAPID state — updated by initVapidKeys() / rotateVapidKeys() at runtime
const _vapid = {
  publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '',
  privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '',
  subject: process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@farmersmarketplace.local',
};

// Kept for backward-compat exports — reflects the current public key
let VAPID_PUBLIC_KEY = _vapid.publicKey;

function isConfigured() {
  return Boolean(_vapid.publicKey && _vapid.privateKey);
}

function configureWebPush() {
  if (!isConfigured()) return;
  webpush.setVapidDetails(_vapid.subject, _vapid.publicKey, _vapid.privateKey);
}

async function ensureVapidKeysTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS vapid_keys (
      id INTEGER PRIMARY KEY,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

/**
 * On first run: if no VAPID keys in env or DB, generate and persist them.
 * On subsequent runs: load from DB when env vars are absent.
 */
async function initVapidKeys() {
  await ensureVapidKeysTable();
  // Env vars take priority — already loaded into _vapid at module load
  if (_vapid.publicKey && _vapid.privateKey) {
    VAPID_PUBLIC_KEY = _vapid.publicKey;
    return;
  }
  const query = db.isPostgres
    ? 'SELECT public_key, private_key FROM vapid_keys ORDER BY id DESC LIMIT 1'
    : 'SELECT public_key, private_key FROM vapid_keys ORDER BY id DESC LIMIT 1';
  const { rows } = await db.query(query);
  if (rows[0]) {
    _vapid.publicKey = rows[0].public_key;
    _vapid.privateKey = rows[0].private_key;
    VAPID_PUBLIC_KEY = _vapid.publicKey;
  } else {
    // First run — generate and persist
    const keys = webpush.generateVAPIDKeys();
    const insertQuery = db.isPostgres
      ? 'INSERT INTO vapid_keys (public_key, private_key) VALUES ($1, $2)'
      : 'INSERT INTO vapid_keys (public_key, private_key) VALUES ($1, $2)';
    await db.query(insertQuery, [keys.publicKey, keys.privateKey]);
    _vapid.publicKey = keys.publicKey;
    _vapid.privateKey = keys.privateKey;
    VAPID_PUBLIC_KEY = _vapid.publicKey;
  }
}

/**
 * Generates new VAPID keys, replaces the stored entry, and updates the running module state.
 * All existing push subscriptions become invalid after rotation; subscribers must re-subscribe.
 */
async function rotateVapidKeys() {
  await ensureVapidKeysTable();
  const keys = webpush.generateVAPIDKeys();
  // Remove existing stored keys and insert fresh ones
  await db.query(db.isPostgres ? 'DELETE FROM vapid_keys' : 'DELETE FROM vapid_keys');
  const insertQuery = db.isPostgres
    ? 'INSERT INTO vapid_keys (public_key, private_key) VALUES ($1, $2)'
    : 'INSERT INTO vapid_keys (public_key, private_key) VALUES ($1, $2)';
  await db.query(insertQuery, [keys.publicKey, keys.privateKey]);
  _vapid.publicKey = keys.publicKey;
  _vapid.privateKey = keys.privateKey;
  VAPID_PUBLIC_KEY = _vapid.publicKey;
  return { publicKey: keys.publicKey };
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

async function ensurePushNotificationHistoryTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS push_notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT,
      title TEXT,
      body TEXT,
      payload TEXT,
      status TEXT NOT NULL CHECK(status IN ('sent','delivered','failed')),
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

async function insertPushNotificationHistory({ userId, endpoint, title, body, payload, status, error }) {
  await ensurePushNotificationHistoryTable();
  const query = db.isPostgres
    ? `INSERT INTO push_notification_history (user_id, endpoint, title, body, payload, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`
    : `INSERT INTO push_notification_history (user_id, endpoint, title, body, payload, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const params = [userId, endpoint, title, body, JSON.stringify(payload), status, error || null];
  const result = await db.query(query, params);
  if (db.isPostgres) {
    return result.rows[0]?.id;
  }
  const lastRow = await db.query('SELECT last_insert_rowid() AS id');
  return lastRow.rows[0]?.id;
}

async function updatePushNotificationHistoryStatus(id, status, error) {
  if (!id) return;
  const query = db.isPostgres
    ? 'UPDATE push_notification_history SET status = $1, error = $2 WHERE id = $3'
    : 'UPDATE push_notification_history SET status = ?, error = ? WHERE id = ?';
  await db.query(query, [status, error || null, id]);
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

  const subscription = JSON.parse(rows[0].subscription);
  const endpoint = subscription.endpoint || null;
  const historyId = await insertPushNotificationHistory({
    userId,
    endpoint,
    title: payload.title,
    body: payload.body,
    payload,
    status: 'sent',
    error: null,
  });

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    await updatePushNotificationHistoryStatus(historyId, 'delivered', null);
  } catch (e) {
    await updatePushNotificationHistoryStatus(historyId, 'failed', e?.message || String(e));
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await deletePushSubscription(userId);
      return;
    }
    throw e;
  }
}

module.exports = {
  get VAPID_PUBLIC_KEY() { return VAPID_PUBLIC_KEY; },
  isConfigured,
  configureWebPush,
  initVapidKeys,
  rotateVapidKeys,
  ensureVapidKeysTable,
  ensurePushSubscriptionTable,
  ensurePushNotificationHistoryTable,
  insertPushNotificationHistory,
  updatePushNotificationHistoryStatus,
  savePushSubscription,
  deletePushSubscription,
  sendPushToUser,
};
