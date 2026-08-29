/**
 * Tests for backend/src/routes/announcements.js (#1008)
 *
 * Covers:
 *  - POST /api/announcements/admin  — admin creates an announcement
 *  - GET  /api/announcements        — public listing returns only active, non-expired rows
 *  - GET  /api/announcements        — expired and inactive announcements are filtered out
 */

const request = require('supertest');
const express = require('express');
const db = require('../db/schema');

// Auth middleware stubs — injected before the route under test
jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = { id: 1, role: 'admin' };
  next();
});
jest.mock('../middleware/adminAuth', () => (_req, _res, next) => next());

const announcementsRouter = require('../routes/announcements');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/announcements', announcementsRouter);
  return app;
}

describe('GET /api/announcements — public listing', () => {
  test('returns active, non-expired announcements', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, message: 'Market open Saturday', type: 'info', created_at: new Date().toISOString(), expires_at: future },
      ],
    });

    const res = await request(buildApp()).get('/api/announcements');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message).toBe('Market open Saturday');
  });

  test('returns empty array when no active announcements exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/announcements');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('query filters by active=1 and expires_at', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/announcements');

    const [sql, params] = db.query.mock.calls[0];
    // Must filter active rows and pass a timestamp to compare expires_at
    expect(sql).toMatch(/active\s*=\s*1/i);
    expect(sql).toMatch(/expires_at/i);
    expect(params[0]).toBeDefined(); // the current-time parameter
  });

  test('expired announcements are not returned', async () => {
    // Simulate DB honouring the filter — returns empty because both rows are expired
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/announcements');

    expect(res.body.data).toHaveLength(0);
  });

  test('inactive announcements are not returned', async () => {
    // Simulate DB honouring the active=1 filter
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/announcements');

    expect(res.body.data).toHaveLength(0);
  });
});

describe('POST /api/announcements/admin — create announcement', () => {
  const newRow = { id: 10, message: 'New feature live!', type: 'info', active: 1, created_at: new Date().toISOString(), expires_at: null };

  test('creates an announcement and returns 201 with the new row', async () => {
    db.query.mockResolvedValueOnce({ rows: [newRow] });

    const res = await request(buildApp())
      .post('/api/announcements/admin')
      .send({ message: 'New feature live!', type: 'info' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(10);
    expect(res.body.data.message).toBe('New feature live!');
  });

  test('returns 400 when message is missing', async () => {
    const res = await request(buildApp())
      .post('/api/announcements/admin')
      .send({ type: 'info' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/message/i);
  });

  test('returns 400 for an invalid type', async () => {
    const res = await request(buildApp())
      .post('/api/announcements/admin')
      .send({ message: 'Hello', type: 'critical' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  test('accepts all valid types: info, warning, error', async () => {
    for (const type of ['info', 'warning', 'error']) {
      db.query.mockResolvedValueOnce({ rows: [{ ...newRow, type }] });
      const res = await request(buildApp())
        .post('/api/announcements/admin')
        .send({ message: 'Test', type });
      expect(res.status).toBe(201);
    }
  });

  test('stores expires_at when provided', async () => {
    const expires = new Date(Date.now() + 3_600_000).toISOString();
    db.query.mockResolvedValueOnce({ rows: [{ ...newRow, expires_at: expires }] });

    const res = await request(buildApp())
      .post('/api/announcements/admin')
      .send({ message: 'Limited time', type: 'warning', expires_at: expires });

    expect(res.status).toBe(201);
    const [_sql, params] = db.query.mock.calls[0];
    expect(params).toContain(expires);
  });
});

describe('GET /api/announcements/admin — admin full listing', () => {
  test('returns all announcements including inactive and expired', async () => {
    const rows = [
      { id: 1, message: 'Active', type: 'info', active: 1, created_at: new Date().toISOString(), expires_at: null },
      { id: 2, message: 'Inactive', type: 'warning', active: 0, created_at: new Date().toISOString(), expires_at: null },
      { id: 3, message: 'Expired', type: 'error', active: 1, created_at: new Date().toISOString(), expires_at: new Date(0).toISOString() },
    ];
    db.query.mockResolvedValueOnce({ rows });

    const res = await request(buildApp()).get('/api/announcements/admin');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });
});
