/**
 * Unit tests for #410 (push subscription cleanup) and #409 (XLM/USD rate caching).
 *
 * db/schema is already mocked globally by tests/jest.setup.js.
 * web-push and node-cron are mocked here.
 */

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

// ---------------------------------------------------------------------------
// #410 — sendPushToUser deletes subscription on 410/404 response
// ---------------------------------------------------------------------------
describe('#410 — push subscription deleted on 410/404 response', () => {
  const USER_ID = 42;
  const SUBSCRIPTION = { endpoint: 'https://push.example.com/sub', keys: { p256dh: 'abc', auth: 'xyz' } };
  let db;
  let webpush;
  let sendPushToUser;

  beforeAll(() => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'pubkey';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'privkey';
    db = jest.requireMock('../db/schema');
    webpush = require('web-push');
    ({ sendPushToUser } = require('../utils/pushNotifications'));
  });

  // jest.setup.js beforeEach calls jest.resetAllMocks() and re-assigns db.query
  // so we set up our per-test mock values after that in a nested beforeEach.

  it('deletes subscription when push service returns 410 Gone', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce({ rows: [{ id: 1, subscription: JSON.stringify(SUBSCRIPTION) }] }) // SELECT
      .mockResolvedValueOnce({ rows: [], changes: 1 }); // DELETE
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: 410 });

    await sendPushToUser(USER_ID, { title: 'Test' });

    const deleteCalls = db.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM push_subscriptions')
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('deletes subscription when push service returns 404 Not Found', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, subscription: JSON.stringify(SUBSCRIPTION) }] })
      .mockResolvedValueOnce({ rows: [], changes: 1 });
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: 404 });

    await sendPushToUser(USER_ID, { title: 'Test' });

    const deleteCalls = db.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM push_subscriptions')
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('re-throws errors that are not 410/404', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, subscription: JSON.stringify(SUBSCRIPTION) }] });
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: 500 });

    await expect(sendPushToUser(USER_ID, { title: 'Test' })).rejects.toMatchObject({ statusCode: 500 });
  });
});

// ---------------------------------------------------------------------------
// #410 — cleanupExpiredPushSubscriptions removes records older than 90 days
// ---------------------------------------------------------------------------
describe('#410 — cleanupExpiredPushSubscriptions', () => {
  let db;
  let cleanupExpiredPushSubscriptions;

  beforeAll(() => {
    db = jest.requireMock('../db/schema');
    ({ cleanupExpiredPushSubscriptions } = require('../jobs/cleanupPushSubscriptions'));
  });

  afterEach(() => {
    db.isPostgres = false;
  });

  it('issues DELETE for subscriptions older than 90 days (SQLite)', async () => {
    db.query.mockResolvedValueOnce({ changes: 3 });

    const count = await cleanupExpiredPushSubscriptions();

    expect(count).toBe(3);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM push_subscriptions');
    expect(sql).toContain('-90 days');
  });

  it('returns 0 when no expired subscriptions exist', async () => {
    db.query.mockResolvedValueOnce({ changes: 0 });

    const count = await cleanupExpiredPushSubscriptions();

    expect(count).toBe(0);
  });

  it('uses INTERVAL syntax for PostgreSQL', async () => {
    db.isPostgres = true;
    db.query.mockResolvedValueOnce({ rowCount: 2 });

    const count = await cleanupExpiredPushSubscriptions();

    expect(count).toBe(2);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('INTERVAL');
  });
});

// ---------------------------------------------------------------------------
// #409 — rates.js XLM/USD caching (60s TTL, stale fallback)
// ---------------------------------------------------------------------------
describe('#409 — rates.js XLM/USD caching', () => {
  let router;
  let mockFetch;

  async function callRoute() {
    const req = {};
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const layer = router.stack.find((l) => l.route?.path === '/xlm-usd');
    await layer.route.stack[0].handle(req, res, jest.fn());
    return res.json.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    jest.resetModules();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    router = require('../routes/rates');
  });

  it('cache miss: fetches from external API and returns rate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stellar: { usd: 0.12 } }),
    });

    const body = await callRoute();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(body.rate).toBe(0.12);
    expect(body.cached).toBe(false);
    expect(body.stale).toBeUndefined();
  });

  it('cache hit: returns cached rate without calling external API again', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stellar: { usd: 0.15 } }),
    });

    await callRoute();       // populates cache
    const body = await callRoute(); // should hit cache

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(body.rate).toBe(0.15);
    expect(body.cached).toBe(true);
  });

  it('stale fallback: returns last known rate with stale:true on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stellar: { usd: 0.20 } }),
    });

    await callRoute(); // populate cache

    // Advance time past 60s TTL
    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;

    mockFetch.mockResolvedValueOnce({ ok: false });
    const body = await callRoute();
    Date.now = realNow;

    expect(body.rate).toBe(0.20);
    expect(body.stale).toBe(true);
    expect(body.success).toBe(true);
  });

  it('cache TTL is 60 seconds', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../routes/rates.js'), 'utf8');
    expect(src).toMatch(/CACHE_TTL\s*=\s*60\s*\*\s*1000/);
  });
});
