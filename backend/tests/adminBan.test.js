/**
 * adminBan.test.js — #1013
 * Dedicated tests for the admin ban/unban endpoint and requireNotBanned middleware.
 *
 * Covers:
 *  - POST /users/:id/ban: auth guards, user not found, cannot ban admin,
 *    already banned, successful ban with/without reason
 *  - DELETE /users/:id/ban: user not found, not currently banned, successful unban
 *  - requireNotBanned middleware: passes through for unbanned users,
 *    rejects freshly-banned users with 403 (session rejection)
 */

jest.mock('../src/db/schema', () => ({ query: jest.fn() }));

const express = require('express');
const supertest = require('supertest');
const db = require('../src/db/schema');
const adminBanRouter = require('../src/routes/adminBan');
const requireNotBanned = require('../src/middleware/requireNotBanned');

// Build a test app that mounts adminBan with a controllable req.user and req.db
function buildApp({ user, userRow, updateResult } = {}) {
  const app = express();
  app.use(express.json());

  // Inject user onto request (simulates auth middleware)
  app.use((req, _res, next) => {
    req.user = user !== undefined ? user : { id: 99, role: 'admin' };
    next();
  });

  db.query.mockImplementation(async (sql) => {
    if (/^\s*SELECT/i.test(sql)) {
      return { rows: userRow ? [userRow] : [], rowCount: userRow ? 1 : 0 };
    }
    return { rows: [], rowCount: updateResult !== undefined ? updateResult : 1 };
  });

  app.use('/', adminBanRouter);
  return app;
}

// ---------------------------------------------------------------------------
// POST /users/:id/ban
// ---------------------------------------------------------------------------
describe('POST /users/:id/ban', () => {
  it('returns 401 when no user is authenticated', async () => {
    const res = await supertest(buildApp({ user: null }))
      .post('/users/1/ban')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated user is not an admin', async () => {
    const res = await supertest(buildApp({ user: { id: 1, role: 'buyer' } }))
      .post('/users/1/ban')
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 404 when the target user does not exist', async () => {
    const res = await supertest(buildApp({ userRow: undefined }))
      .post('/users/999/ban')
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when trying to ban an admin account', async () => {
    const res = await supertest(buildApp({ userRow: { id: 2, role: 'admin', banned_at: null } }))
      .post('/users/2/ban')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot ban an admin/i);
  });

  it('returns 409 when the user is already banned', async () => {
    const res = await supertest(buildApp({ userRow: { id: 3, role: 'buyer', banned_at: new Date() } }))
      .post('/users/3/ban')
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already banned/i);
  });

  it('returns 200 and bans the user without a reason', async () => {
    const res = await supertest(buildApp({ userRow: { id: 4, role: 'buyer', banned_at: null } }))
      .post('/users/4/ban')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/banned/i);
    expect(res.body.reason).toBeNull();
  });

  it('returns 200 and stores the ban reason', async () => {
    const res = await supertest(buildApp({ userRow: { id: 5, role: 'farmer', banned_at: null } }))
      .post('/users/5/ban')
      .send({ reason: 'spam' });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('spam');
  });

  it('returns banned_at timestamp in the response', async () => {
    const res = await supertest(buildApp({ userRow: { id: 6, role: 'buyer', banned_at: null } }))
      .post('/users/6/ban')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.banned_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DELETE /users/:id/ban
// ---------------------------------------------------------------------------
describe('DELETE /users/:id/ban', () => {
  it('returns 401 when no user is authenticated', async () => {
    const res = await supertest(buildApp({ user: null }))
      .delete('/users/1/ban');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated user is not an admin', async () => {
    const res = await supertest(buildApp({ user: { id: 1, role: 'farmer' } }))
      .delete('/users/1/ban');
    expect(res.status).toBe(403);
  });

  it('returns 404 when the target user does not exist', async () => {
    const res = await supertest(buildApp({ userRow: undefined }))
      .delete('/users/999/ban');
    expect(res.status).toBe(404);
  });

  it('returns 409 when the user is not currently banned', async () => {
    const res = await supertest(buildApp({ userRow: { id: 7, role: 'buyer', banned_at: null } }))
      .delete('/users/7/ban');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not banned/i);
  });

  it('returns 200 and unbans the user', async () => {
    const res = await supertest(buildApp({ userRow: { id: 8, role: 'buyer', banned_at: new Date() } }))
      .delete('/users/8/ban');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/unbanned/i);
  });
});

// ---------------------------------------------------------------------------
// requireNotBanned middleware
// ---------------------------------------------------------------------------
describe('requireNotBanned middleware', () => {
  function buildMiddlewareApp(user) {
    const app = express();
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
    app.use(requireNotBanned);
    app.get('/protected', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('calls next() for an authenticated user with no ban', async () => {
    const res = await supertest(buildMiddlewareApp({ id: 1, banned_at: null }))
      .get('/protected');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('calls next() when req.user is undefined (unauthenticated)', async () => {
    const res = await supertest(buildMiddlewareApp(undefined))
      .get('/protected');
    expect(res.status).toBe(200);
  });

  it('returns 403 immediately for a freshly-banned user (session rejection)', async () => {
    const res = await supertest(buildMiddlewareApp({ id: 2, banned_at: new Date() }))
      .get('/protected');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it('403 response includes a support contact hint', async () => {
    const res = await supertest(buildMiddlewareApp({ id: 3, banned_at: new Date() }))
      .get('/protected');
    expect(res.body.error).toMatch(/contact support/i);
  });
});
