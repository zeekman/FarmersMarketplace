'use strict';
/**
 * Issue #1019 — End-to-end dispute lifecycle integration test.
 *
 * Spans the full dispute flow across the backend disputes.js route and the
 * mocked Soroban escrow contract:
 *   1. Buyer opens a dispute via POST /api/disputes
 *   2. Admin resolves it via PATCH /api/disputes/:id/resolve
 *   3. DB order/dispute status is asserted to reflect the on-chain outcome
 *
 * The escrow contract (invokeEscrowContract) is mocked to isolate network I/O
 * while still exercising the route → contract invocation path.
 */

const jwt = require('jsonwebtoken');
const { request, app, mockDb } = require('./setup');
const mailer = jest.requireMock('../src/utils/mailer');
const stellar = jest.requireMock('../src/utils/stellar');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 10, role: 'buyer' }, SECRET);
const adminToken = jwt.sign({ id: 99, role: 'admin' }, SECRET);

const ORDER_ID = 42;

// ── shared fixtures ────────────────────────────────────────────────────────────

const paidOrder = {
  id: ORDER_ID,
  buyer_id: 10,
  farmer_id: 20,
  product_id: 7,
  status: 'paid',
  total_price: '50.00',
  quantity: 2,
  updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 h ago — within 72 h window
  farmer_wallet: 'GFARMER',
  farmer_id: 20,
  farmer_email: 'farmer@test.com',
  farmer_name: 'Test Farmer',
};

const buyer = {
  id: 10,
  name: 'Test Buyer',
  email: 'buyer@test.com',
  stellar_public_key: 'GBUYER',
  stellar_secret_key: 'SBUYER',
};

const farmer = {
  id: 20,
  name: 'Test Farmer',
  email: 'farmer@test.com',
  stellar_public_key: 'GFARMER',
  stellar_secret_key: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // invokeEscrowContract is used by disputes route — mock it as non-fatal success
  stellar.invokeEscrowContract = jest.fn().mockResolvedValue({ txHash: 'ESCROW_DISPUTE_TX' });
  stellar.burnRewardTokens = jest.fn().mockResolvedValue({});
});

// ── Step 1: Open a dispute ─────────────────────────────────────────────────────

describe('POST /api/disputes — buyer opens a dispute', () => {
  it('creates a dispute and calls escrow contract (non-fatal)', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [paidOrder], rowCount: 1 })       // order lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                 // no existing dispute
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })       // INSERT dispute RETURNING
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 });           // buyer lookup (for escrow)

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: ORDER_ID, reason: 'Item never arrived' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, order_id: ORDER_ID, status: 'open' });

    // Escrow contract should be called asynchronously — give it a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(stellar.invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute', orderId: ORDER_ID })
    );
  });

  it('returns 404 when order does not belong to the buyer', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 999, reason: 'test' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when a dispute already exists for the order', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [paidOrder], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 }); // existing dispute

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: ORDER_ID, reason: 'test' });

    expect(res.status).toBe(409);
  });
});

// ── Step 2: Admin resolves the dispute ────────────────────────────────────────

describe('PATCH /api/disputes/:id/resolve — admin resolves a dispute', () => {
  const openDispute = {
    id: 1,
    order_id: ORDER_ID,
    buyer_id: 10,
    farmer_id: 20,
    status: 'open',
    resolution: null,
    total_price: '50.00',
    product_id: 7,
  };

  it('resolves in favour of buyer — triggers escrow refund and updates DB status', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 })          // dispute lookup
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })                 // buyer lookup
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })                // farmer lookup
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SADMIN' }], rowCount: 1 }) // admin key
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                      // UPDATE disputes
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Tomatoes' }], rowCount: 1 }); // product

    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'buyer' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, status: 'resolved', resolution: 'buyer' });

    // Escrow refund should be invoked for a buyer-win resolution
    await new Promise((r) => setTimeout(r, 20));
    expect(stellar.invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refund', orderId: ORDER_ID })
    );
  });

  it('resolves in favour of farmer — triggers escrow release', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SADMIN' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Tomatoes' }], rowCount: 1 });

    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'farmer' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'farmer' });

    await new Promise((r) => setTimeout(r, 20));
    expect(stellar.invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'release' })
    );
  });

  it('resolves with split — passes splitPercentBuyer to escrow contract', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SADMIN' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Tomatoes' }], rowCount: 1 });

    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'split', split_percent_buyer: 60 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'split' });

    await new Promise((r) => setTimeout(r, 20));
    expect(stellar.invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refund', splitPercentBuyer: 60 })
    );
  });

  it('returns 400 when resolution value is invalid', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 });

    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'nobody' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when split resolution is missing split_percent_buyer', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 });

    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'split' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when dispute is already resolved', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ ...openDispute, status: 'resolved' }],
      rowCount: 1,
    });

    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'buyer' });

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admins', async () => {
    const res = await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ resolution: 'buyer' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown dispute', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .patch('/api/disputes/9999/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'buyer' });

    expect(res.status).toBe(404);
  });

  it('sends dispute-resolved email notification after resolution', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [openDispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buyer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [farmer], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SADMIN' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Tomatoes' }], rowCount: 1 });

    await request(app)
      .patch('/api/disputes/1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'buyer' });

    await new Promise((r) => setTimeout(r, 20));
    expect(mailer.sendDisputeResolvedEmail).toHaveBeenCalled();
  });
});
