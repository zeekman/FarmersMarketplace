/**
 * Tests for routes/adminContractAlerts.js (#1368, #009)
 *
 * The router is mounted at /admin/contract-alerts and guards every endpoint
 * with auth + requireAdmin. These tests mount it directly and prove that a
 * non-admin receives 403 on each admin endpoint.
 */

const request = require('supertest');
const express = require('express');
const adminContractAlertsRouter = require('../routes/adminContractAlerts');

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
  app.use('/api/admin/contract-alerts', adminContractAlertsRouter);
  return app;
}

describe('admin-only contract-alert endpoints reject non-admins with 403 (#009)', () => {
  const buyerApp = () => buildApp({ id: 2, role: 'buyer' });

  test('GET /api/admin/contract-alerts returns 403 for a non-admin', async () => {
    const res = await request(buyerApp()).get('/api/admin/contract-alerts');
    expect(res.status).toBe(403);
  });

  test('PATCH /api/admin/contract-alerts/:id/acknowledge returns 403 for a non-admin', async () => {
    const res = await request(buyerApp()).patch('/api/admin/contract-alerts/1/acknowledge');
    expect(res.status).toBe(403);
  });

  test('POST /api/admin/contract-alerts/:id/acknowledge returns 403 for a non-admin', async () => {
    const res = await request(buyerApp()).post('/api/admin/contract-alerts/1/acknowledge');
    expect(res.status).toBe(403);
  });

  test('an admin passes the guard (GET returns 200)', async () => {
    const db = require('../db/schema');
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildApp()).get('/api/admin/contract-alerts');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
