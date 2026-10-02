'use strict';
/**
 * PATCH /api/disputes/:id/resolve → escrow `resolve_dispute` mapping (#1299).
 *
 * Mounts only the disputes router (all collaborators mocked) so the route's
 * contract-invocation logic is verified without booting the full app.
 */

const express = require('express');
const request = require('supertest');

// jest.fn() instances (not wrappers): tests/jest.setup.js re-primes these mocks.
const mockQuery = jest.fn();
const mockInvokeEscrowContract = jest.fn();

jest.mock('../src/db/schema', () => ({ query: mockQuery, isPostgres: false }));
jest.mock('../src/middleware/auth', () => (req, _res, next) => {
  req.user = { id: 99, role: req.get('x-role') || 'admin' };
  next();
});
jest.mock('../src/middleware/validate', () => ({ dispute: (_req, _res, next) => next() }));
// The shared tests/jest.setup.js primes several mailer functions in a beforeEach, so
// hand out a jest.fn() for any property that is read.
jest.mock('../src/utils/mailer', () => {
  const fns = {};
  return new Proxy(fns, {
    get: (target, name) => (name in target ? target[name] : (target[name] = jest.fn().mockResolvedValue())),
  });
});
jest.mock('../src/utils/stellar', () => ({
  burnRewardTokens: jest.fn().mockResolvedValue({}),
  invokeEscrowContract: mockInvokeEscrowContract,
}));
jest.mock('../src/utils/pushNotifications', () => ({ sendPushToUser: jest.fn().mockResolvedValue() }));
jest.mock('../src/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/utils/auditLog', () => ({ writeAuditLog: jest.fn().mockResolvedValue() }));

const disputesRouter = require('../src/routes/disputes');

const app = express();
app.use(express.json());
app.use('/api/disputes', disputesRouter);
// eslint-disable-next-line no-unused-vars
app.use((e, _req, res, _next) => res.status(500).json({ error: e.message }));

const openDispute = {
  id: 1, order_id: 42, buyer_id: 10, farmer_id: 20, status: 'open',
  total_price: '50.00', product_id: 7,
};

function primeDb({ adminSecret = 'SADMIN' } = {}) {
  mockQuery
    .mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ id: 10, stellar_public_key: 'GBUYER' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ id: 20, stellar_public_key: 'GFARMER' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ stellar_secret_key: adminSecret }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Tomatoes' }], rowCount: 1 });
}

const tick = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  // tests/jest.setup.js replaces `db.query` before every test; re-attach ours.
  require('../src/db/schema').query = mockQuery;
  mockQuery.mockReset();
  mockInvokeEscrowContract.mockReset().mockResolvedValue({ txHash: 'TX' });
  // The shared setup resets mock implementations between tests; re-prime the rest.
  jest.requireMock('../src/utils/stellar').burnRewardTokens.mockResolvedValue({});
  jest.requireMock('../src/utils/pushNotifications').sendPushToUser.mockResolvedValue();
  jest.requireMock('../src/utils/auditLog').writeAuditLog.mockResolvedValue();
});

describe('PATCH /api/disputes/:id/resolve', () => {
  it.each([
    [{ resolution: 'buyer' }, 10000],
    [{ resolution: 'farmer' }, 0],
    [{ resolution: 'split', split_percent_buyer: 60 }, 6000],
    [{ resolution: 'split', split_percent_buyer: 0 }, 0],
    [{ resolution: 'split', split_percent_buyer: 100 }, 10000],
    [{ resolution: 'split', split_percent_buyer: 33.33 }, 3333],
  ])('%j → one resolve_dispute call with buyerBps=%i', async (body, bps) => {
    primeDb();
    const res = await request(app).patch('/api/disputes/1/resolve').send(body);
    expect(res.status).toBe(200);
    await tick();
    expect(mockInvokeEscrowContract).toHaveBeenCalledTimes(1);
    expect(mockInvokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'resolve_dispute',
        senderSecret: 'SADMIN',
        orderId: 42,
        buyerBps: bps,
      })
    );
  });

  it.each([[-1], [101], ['abc'], ['60'], [null], [undefined], [Number.NaN]])(
    'rejects split_percent_buyer=%p with 400 and never touches the contract',
    async (bad) => {
      mockQuery.mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 });
      const res = await request(app)
        .patch('/api/disputes/1/resolve')
        .send({ resolution: 'split', split_percent_buyer: bad });
      expect(res.status).toBe(400);
      expect(mockInvokeEscrowContract).not.toHaveBeenCalled();
    }
  );

  it('does not call the contract when the admin has no stellar key, but still resolves the dispute', async () => {
    primeDb({ adminSecret: null });
    const res = await request(app).patch('/api/disputes/1/resolve').send({ resolution: 'buyer' });
    expect(res.status).toBe(200);
    await tick();
    expect(mockInvokeEscrowContract).not.toHaveBeenCalled();
  });

  it('a failing contract call is non-fatal', async () => {
    mockInvokeEscrowContract.mockRejectedValue(new Error('rpc down'));
    primeDb();
    const res = await request(app).patch('/api/disputes/1/resolve').send({ resolution: 'farmer' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'farmer' });
  });

  it('is admin-only', async () => {
    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('x-role', 'buyer')
      .send({ resolution: 'buyer' });
    expect(res.status).toBe(403);
    expect(mockInvokeEscrowContract).not.toHaveBeenCalled();
  });
});
