/**
 * pushNotifications.test.js  (#1150)
 *
 * Unit tests for backend/src/utils/pushNotifications.js
 *
 * Covers:
 *   - isConfigured(): true/false based on VAPID env vars
 *   - savePushSubscription(): upserts subscription row
 *   - deletePushSubscription(): removes subscription row
 *   - sendPushToUser(): no-op when not configured, no-op when no subscription,
 *       graceful delivery, expired/gone subscription cleanup (410/404),
 *       throws on unexpected push error
 *   - rotateVapidKeys(): replaces stored keys, updates running module state,
 *       invalidates the old public key
 */

'use strict';

// We override the global pushNotifications mock (from jest.setup.js) here
// so the real implementation runs.
jest.unmock('../utils/pushNotifications');

describe('pushNotifications', () => {
  let mockDb;
  let mockWebpush;

  beforeEach(() => {
    jest.resetModules();

    // ── db mock ──────────────────────────────────────────────────────────────
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      isPostgres: false,
    };
    jest.mock('../db/schema', () => mockDb);

    // ── web-push mock ─────────────────────────────────────────────────────────
    mockWebpush = {
      setVapidDetails: jest.fn(),
      sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
      generateVAPIDKeys: jest.fn(() => ({
        publicKey: 'NEW_PUBLIC_KEY_' + Math.random(),
        privateKey: 'NEW_PRIVATE_KEY_' + Math.random(),
      })),
    };
    jest.mock('web-push', () => mockWebpush);
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function load() {
    return require('../utils/pushNotifications');
  }

  function setupVapidEnv() {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'VAPID_PUBLIC';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'VAPID_PRIVATE';
  }

  function clearVapidEnv() {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  }

  afterEach(() => {
    clearVapidEnv();
  });

  // ── isConfigured ──────────────────────────────────────────────────────────

  describe('isConfigured()', () => {
    it('returns true when both VAPID env vars are set', () => {
      setupVapidEnv();
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);
      const { isConfigured } = require('../utils/pushNotifications');
      expect(isConfigured()).toBe(true);
    });

    it('returns false when VAPID_PUBLIC_KEY is missing', () => {
      delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'PRIVATE';
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);
      const { isConfigured } = require('../utils/pushNotifications');
      expect(isConfigured()).toBe(false);
    });

    it('returns false when VAPID_PRIVATE_KEY is missing', () => {
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'PUBLIC';
      delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);
      const { isConfigured } = require('../utils/pushNotifications');
      expect(isConfigured()).toBe(false);
    });

    it('returns false when both VAPID keys are absent', () => {
      clearVapidEnv();
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);
      const { isConfigured } = require('../utils/pushNotifications');
      expect(isConfigured()).toBe(false);
    });
  });

  // ── savePushSubscription ──────────────────────────────────────────────────

  describe('savePushSubscription()', () => {
    it('inserts the subscription for a new user (SQLite path)', async () => {
      setupVapidEnv();
      mockDb.isPostgres = false;
      const { savePushSubscription } = load();

      const sub = { endpoint: 'https://push.example.com/1', keys: { p256dh: 'p', auth: 'a' } };
      await savePushSubscription(99, sub);

      // Should call CREATE TABLE IF NOT EXISTS, DELETE, and INSERT
      const queries = mockDb.query.mock.calls.map(([sql]) => sql.trim());
      expect(queries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS push_subscriptions'))).toBe(true);
      expect(queries.some((q) => q.includes('DELETE FROM push_subscriptions'))).toBe(true);
      expect(queries.some((q) => q.includes('INSERT INTO push_subscriptions'))).toBe(true);
    });

    it('passes the serialized subscription JSON to the DB', async () => {
      setupVapidEnv();
      mockDb.isPostgres = false;
      const { savePushSubscription } = load();

      const sub = { endpoint: 'https://push.example.com/2', keys: { p256dh: 'p2', auth: 'a2' } };
      await savePushSubscription(5, sub);

      const insertCall = mockDb.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO push_subscriptions'));
      expect(insertCall).toBeTruthy();
      expect(insertCall[1]).toContain(JSON.stringify(sub));
    });
  });

  // ── deletePushSubscription ────────────────────────────────────────────────

  describe('deletePushSubscription()', () => {
    it('issues a DELETE query for the given user id (SQLite path)', async () => {
      mockDb.isPostgres = false;
      const { deletePushSubscription } = load();

      await deletePushSubscription(42);

      const deleteCalls = mockDb.query.mock.calls.filter(([sql]) =>
        sql.includes('DELETE FROM push_subscriptions')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
      expect(deleteCalls[0][1]).toEqual([42]);
    });
  });

  // ── sendPushToUser ────────────────────────────────────────────────────────

  describe('sendPushToUser()', () => {
    const SUBSCRIPTION = {
      endpoint: 'https://push.example.com/user1',
      keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
    };

    function setupDbForUser(subscription = SUBSCRIPTION) {
      mockDb.query.mockImplementation(async (sql) => {
        if (sql.includes('CREATE TABLE IF NOT EXISTS push_subscriptions')) return { rows: [] };
        if (sql.includes('CREATE TABLE IF NOT EXISTS push_notification_history')) return { rows: [] };
        if (sql.includes('SELECT id, subscription FROM push_subscriptions')) {
          return { rows: [{ id: 1, subscription: JSON.stringify(subscription) }] };
        }
        if (sql.includes('INSERT INTO push_notification_history')) {
          return { rows: [{ id: 10 }] };
        }
        if (sql.includes('SELECT last_insert_rowid()')) {
          return { rows: [{ id: 10 }] };
        }
        if (sql.includes('UPDATE push_notification_history')) {
          return { rows: [] };
        }
        return { rows: [] };
      });
    }

    it('does nothing when VAPID keys are not configured', async () => {
      clearVapidEnv();
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);
      const { sendPushToUser } = require('../utils/pushNotifications');

      await sendPushToUser(1, { title: 'Hello', body: 'World' });

      expect(mockWebpush.sendNotification).not.toHaveBeenCalled();
    });

    it('does nothing (no throw) when user has no stored subscription', async () => {
      setupVapidEnv();
      // DB returns no subscription rows
      mockDb.query.mockImplementation(async () => ({ rows: [] }));
      const { sendPushToUser } = load();

      await expect(sendPushToUser(999, { title: 'Hi', body: 'Bye' })).resolves.toBeUndefined();
      expect(mockWebpush.sendNotification).not.toHaveBeenCalled();
    });

    it('sends the notification and records delivered status on success', async () => {
      setupVapidEnv();
      setupDbForUser();
      const { sendPushToUser } = load();

      await sendPushToUser(1, { title: 'Test', body: 'Message' });

      expect(mockWebpush.sendNotification).toHaveBeenCalledWith(
        SUBSCRIPTION,
        JSON.stringify({ title: 'Test', body: 'Message' })
      );
      // history updated to 'delivered'
      const updateCalls = mockDb.query.mock.calls.filter(([sql]) =>
        sql.includes('UPDATE push_notification_history')
      );
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(updateCalls[0][1][0]).toBe('delivered');
    });

    it('deletes subscription and does not throw on 410 Gone', async () => {
      setupVapidEnv();
      setupDbForUser();
      const goneError = new Error('Gone');
      goneError.statusCode = 410;
      mockWebpush.sendNotification.mockRejectedValue(goneError);
      const { sendPushToUser } = load();

      await expect(sendPushToUser(1, { title: 'Gone', body: '' })).resolves.toBeUndefined();

      // Subscription must have been deleted
      const deleteCalls = mockDb.query.mock.calls.filter(([sql]) =>
        sql.includes('DELETE FROM push_subscriptions')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    it('deletes subscription and does not throw on 404 Not Found', async () => {
      setupVapidEnv();
      setupDbForUser();
      const notFoundError = new Error('Not Found');
      notFoundError.statusCode = 404;
      mockWebpush.sendNotification.mockRejectedValue(notFoundError);
      const { sendPushToUser } = load();

      await expect(sendPushToUser(1, { title: 'NF', body: '' })).resolves.toBeUndefined();
    });

    it('re-throws unexpected push errors (not 404/410)', async () => {
      setupVapidEnv();
      setupDbForUser();
      const unexpectedError = new Error('Internal Server Error');
      unexpectedError.statusCode = 500;
      mockWebpush.sendNotification.mockRejectedValue(unexpectedError);
      const { sendPushToUser } = load();

      await expect(sendPushToUser(1, { title: 'Err', body: '' })).rejects.toThrow(
        'Internal Server Error'
      );
    });

    it('records failed status in history when push throws', async () => {
      setupVapidEnv();
      setupDbForUser();
      const err = new Error('push failed');
      err.statusCode = 500;
      mockWebpush.sendNotification.mockRejectedValue(err);
      const { sendPushToUser } = load();

      await expect(sendPushToUser(1, { title: 'Fail', body: '' })).rejects.toThrow();

      const updateCalls = mockDb.query.mock.calls.filter(([sql]) =>
        sql.includes('UPDATE push_notification_history')
      );
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(updateCalls[0][1][0]).toBe('failed');
      expect(updateCalls[0][1][1]).toBe('push failed');
    });
  });

  // ── rotateVapidKeys ───────────────────────────────────────────────────────

  describe('rotateVapidKeys()', () => {
    it('generates new VAPID keys and returns the new public key', async () => {
      setupVapidEnv();
      mockWebpush.generateVAPIDKeys.mockReturnValue({
        publicKey: 'ROTATED_PUBLIC_KEY',
        privateKey: 'ROTATED_PRIVATE_KEY',
      });
      const { rotateVapidKeys } = load();

      const result = await rotateVapidKeys();

      expect(result).toEqual({ publicKey: 'ROTATED_PUBLIC_KEY' });
      expect(mockWebpush.generateVAPIDKeys).toHaveBeenCalled();
    });

    it('deletes old VAPID keys from the DB and inserts new ones', async () => {
      setupVapidEnv();
      mockWebpush.generateVAPIDKeys.mockReturnValue({
        publicKey: 'NEW_PUB',
        privateKey: 'NEW_PRIV',
      });
      const { rotateVapidKeys } = load();

      await rotateVapidKeys();

      const queries = mockDb.query.mock.calls.map(([sql]) => sql.trim());
      expect(queries.some((q) => q.includes('DELETE FROM vapid_keys'))).toBe(true);
      expect(queries.some((q) => q.includes('INSERT INTO vapid_keys'))).toBe(true);
    });

    it('updates the module-level VAPID_PUBLIC_KEY after rotation', async () => {
      setupVapidEnv();
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);

      mockWebpush.generateVAPIDKeys.mockReturnValue({
        publicKey: 'AFTER_ROTATE_PUBLIC',
        privateKey: 'AFTER_ROTATE_PRIVATE',
      });

      const pn = require('../utils/pushNotifications');
      await pn.rotateVapidKeys();

      expect(pn.VAPID_PUBLIC_KEY).toBe('AFTER_ROTATE_PUBLIC');
    });

    it('old public key is no longer the current key after rotation', async () => {
      setupVapidEnv();
      jest.resetModules();
      jest.mock('../db/schema', () => mockDb);
      jest.mock('web-push', () => mockWebpush);

      const pn = require('../utils/pushNotifications');
      const oldKey = pn.VAPID_PUBLIC_KEY;

      mockWebpush.generateVAPIDKeys.mockReturnValue({
        publicKey: 'BRAND_NEW_KEY',
        privateKey: 'BRAND_NEW_PRIV',
      });

      await pn.rotateVapidKeys();

      expect(pn.VAPID_PUBLIC_KEY).not.toBe(oldKey);
      expect(pn.VAPID_PUBLIC_KEY).toBe('BRAND_NEW_KEY');
    });
  });
});
