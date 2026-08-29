process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../db/schema', () => ({
  query: jest.fn(),
  isPostgres: false,
  placeholder: () => '?',
}));

jest.mock('web-push', () => ({
  sendNotification: jest.fn(),
  setVapidDetails: jest.fn(),
  generateVAPIDKeys: jest.fn(() => ({
    publicKey: 'BDd3_hVL7e_J0VL5R5k1sMnfNjz6kgBJyKJMN_ZXGwc',
    privateKey: 'test-private-key-for-jest',
  })),
}));

// Override the global pushNotifications stub so the real sendPushToUser runs here
jest.unmock('../utils/pushNotifications');

const mockDb = require('../db/schema');
const webpush = require('web-push');
const app = require('../app');
const { sendPushToUser } = require('../utils/pushNotifications');

const SECRET = process.env.JWT_SECRET;
const userToken = jwt.sign({ id: 1, role: 'buyer' }, SECRET);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('push notification delivery history', () => {
  it('records delivered status when push send succeeds', async () => {
    const subscription = { endpoint: 'https://example.com/push', keys: { p256dh: 'p256dh', auth: 'auth' } };
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS push_subscriptions')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('CREATE TABLE IF NOT EXISTS push_notification_history')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT id, subscription FROM push_subscriptions')) {
        return { rows: [{ id: 1, subscription: JSON.stringify(subscription) }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO push_notification_history')) {
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      if (sql.includes('SELECT last_insert_rowid() AS id')) {
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      if (sql.includes('UPDATE push_notification_history')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    webpush.sendNotification.mockResolvedValue();

    await sendPushToUser(1, { title: 'Test', body: 'Hello', url: '/test' });

    expect(webpush.sendNotification).toHaveBeenCalledWith(subscription, JSON.stringify({ title: 'Test', body: 'Hello', url: '/test' }));
    expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO push_notification_history'), expect.any(Array));
    expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE push_notification_history'), ['delivered', null, 42]);
  });
});

describe('GET /api/notifications/history', () => {
  it('returns the authenticated user notification history', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT active FROM users WHERE id')) {
        return { rows: [{ active: 1 }], rowCount: 1 };
      }
      if (sql.includes('SELECT COUNT(*)')) {
        return { rows: [{ count: '1' }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, title, body, status, error, created_at')) {
        return {
          rows: [
            {
              id: 1,
              title: 'Test Notification',
              body: 'Delivery history works',
              status: 'delivered',
              error: null,
              created_at: '2026-06-02T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .get('/api/notifications/history')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('delivered');
  });
});
