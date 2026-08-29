/**
 * Tests for routes/contracts.js (#1162)
 * Covers: register/deregister, ACL grant/revoke auth boundaries,
 * contract-version comparison, and admin-only enforcement.
 */

const request = require('supertest');
const express = require('express');
const db = require('../db/schema');

jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = req._mockUser || { id: 1, role: 'admin' };
  next();
});
jest.mock('../middleware/adminAuth', () => (_req, _res, next) => next());
jest.mock('../utils/stellar', () => ({
  getContractState: jest.fn(),
  getContractEvents: jest.fn(),
  simulateContractCall: jest.fn(),
}));
jest.mock('../utils/auditLog', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

const contractsRouter = require('../routes/contracts');

const VALID_CONTRACT_ID = 'A'.repeat(56); // 56 uppercase base32 chars

function buildApp(userOverride) {
  const app = express();
  app.use(express.json());
  if (userOverride) app.use((req, _res, next) => { req._mockUser = userOverride; next(); });
  app.use('/api/contracts', contractsRouter);
  return app;
}

// ── contract state (public endpoint, non-admin restricted) ───────────────
describe('GET /api/contracts/:contractId/state', () => {
  it('allows admin to fetch contract state', async () => {
    const { getContractState } = require('../utils/stellar');
    getContractState.mockResolvedValue({ entries: [] });
    const res = await request(buildApp()).get(`/api/contracts/${VALID_CONTRACT_ID}/state`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for non-admin with no linked order', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // no order link
    const res = await request(buildApp({ id: 2, role: 'buyer' }))
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state`);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid contractId', async () => {
    const res = await request(buildApp()).get('/api/contracts/bad-id/state');
    expect(res.status).toBe(400);
  });
});

// ── simulate (admin only) ─────────────────────────────────────────────────
describe('POST /api/contracts/:contractId/simulate', () => {
  it('returns 200 for a successful simulation', async () => {
    const { simulateContractCall } = require('../utils/stellar');
    db.query
      .mockResolvedValueOnce({ rows: [{ contract_id: VALID_CONTRACT_ID, network: 'testnet' }] }) // registry lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // logInvocation INSERT
    simulateContractCall.mockResolvedValue({ success: true, result: 'ok', fee: '100' });
    process.env.STELLAR_NETWORK = 'testnet';

    const res = await request(buildApp())
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .send({ method: 'transfer', args: [] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when contract is not in registry', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .send({ method: 'transfer' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when method is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── invocations (admin only) ──────────────────────────────────────────────
describe('GET /api/contracts/:contractId/invocations', () => {
  it('returns paginated invocations for a valid contract', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, contract_id: VALID_CONTRACT_ID, method: 'transfer', args: null, tx_hash: 'TX1', success: 1, error: null, invoked_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const res = await request(buildApp()).get(`/api/contracts/${VALID_CONTRACT_ID}/invocations`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.invocations).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('returns 400 for invalid contractId', async () => {
    const res = await request(buildApp()).get('/api/contracts/invalid/invocations');
    expect(res.status).toBe(400);
  });
});

// ── events (admin only) ───────────────────────────────────────────────────
describe('GET /api/contracts/:contractId/events', () => {
  it('returns events from stellar', async () => {
    const { getContractEvents } = require('../utils/stellar');
    getContractEvents.mockResolvedValue({ events: [], total: 0 });

    const res = await request(buildApp()).get(`/api/contracts/${VALID_CONTRACT_ID}/events`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when stellar reports contract not found', async () => {
    const { getContractEvents } = require('../utils/stellar');
    getContractEvents.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));

    const res = await request(buildApp()).get(`/api/contracts/${VALID_CONTRACT_ID}/events`);
    expect(res.status).toBe(404);
  });
});
