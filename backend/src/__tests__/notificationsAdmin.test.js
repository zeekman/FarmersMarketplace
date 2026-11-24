/**
 * Tests for the admin-only endpoint in routes/notifications.js (#009)
 *
 * POST /api/notifications/admin/rotate-vapid-keys is guarded with
 * auth + requireAdmin. This mounts the router directly and proves that a
 * non-admin receives 403.
 */

const request = require('supertest');
const express = require('express');
const notificationsRouter = require('../routes/notifications');

// Inject the user via the auth middleware so the real requireAdmin runs.
jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = req._mockUser || { id: 1, role: 'admin' };
  next();
});
jest.mock('../utils/auditLog', () => ({ writeAuditLog: async () => undefined }));

function buildApp(user) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      req._mockUser = user;
      next();
    });
  }
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('admin-only notification endpoints reject non-admins with 403 (#009)', () => {
  test('POST /api/notifications/admin/rotate-vapid-keys returns 403 for a non-admin', async () => {
    const res = await request(buildApp({ id: 2, role: 'buyer' }))
      .post('/api/notifications/admin/rotate-vapid-keys');
    expect(res.status).toBe(403);
  });
});
