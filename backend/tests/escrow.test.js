'use strict';

const { request, app, mockQuery } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken  = jwt.sign({ id: 1, role: 'buyer' },  JWT_SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });
const otherBuyer  = jwt.sign({ id: 99, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });

const baseOrder = {
  id: 10, buyer_id: 1, product_id: 5, quantity: 2, total_price: 20,
  status: 'paid', escrow_status: 'none', escrow_balance_id: null,
  farmer_id: 2, farmer_wallet: 'GFARMER',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  stellar.getBalance.mockResolvedValue(1000);
  stellar.createClaimableBalance.mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BALANCE_ID_001' });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
});

describe('POST /api/orders/:id/escrow', () => {
  test('403 if caller is not a buyer', async () => {
    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('403 if order belongs to a different buyer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseOrder, buyer_id: 1 }], rowCount: 1 });
    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${otherBuyer}`);
    expect(res.status).toBe(403);
  });

  test('404 if order not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  test('400 if escrow already initiated', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...baseOrder, escrow_status: 'funded' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }], rowCount: 1 });
    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  test('402 if buyer has insufficient balance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrder], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }], rowCount: 1 });
    stellar.getBalance.mockResolvedValue(0.5);
    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('insufficient_balance');
  });

  test('200 — creates claimable balance and saves to DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrder], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE order

    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.balanceId).toBe('BALANCE_ID_001');
    expect(stellar.createClaimableBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 20 }));
  });

  test('402 — Stellar SDK failure is handled gracefully', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrder], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }], rowCount: 1 });
    stellar.createClaimableBalance.mockRejectedValue(new Error('op_underfunded'));
    const res = await request(app).post('/api/orders/10/escrow').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('escrow_failed');
    expect(res.body.message).toMatch('op_underfunded');
  });
});

describe('POST /api/orders/:id/claim', () => {
  const fundedOrder = { ...baseOrder, status: 'delivered', escrow_status: 'funded', escrow_balance_id: 'BALANCE_ID_001' };

  test('403 if caller is not a farmer', async () => {
    const res = await request(app).post('/api/orders/10/claim').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  test("404 if order not found or not this farmer's", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).post('/api/orders/10/claim').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  test('400 if escrow_status is not funded', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...fundedOrder, escrow_status: 'none' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SFARMER' }], rowCount: 1 });
    const res = await request(app).post('/api/orders/10/claim').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  test('400 if order is not delivered yet', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...fundedOrder, status: 'shipped' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SFARMER' }], rowCount: 1 });
    const res = await request(app).post('/api/orders/10/claim').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  test('200 — claims balance and updates DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [fundedOrder], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SFARMER' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE order

    const res = await request(app).post('/api/orders/10/claim').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('CLAIM_TX_001');
    expect(stellar.claimBalance).toHaveBeenCalledWith({ claimantSecret: 'SFARMER', balanceId: 'BALANCE_ID_001' });
  });

  test('402 — Stellar claim failure is handled gracefully', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [fundedOrder], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'SFARMER' }], rowCount: 1 });
    stellar.claimBalance.mockRejectedValue(new Error('op_does_not_exist'));
    const res = await request(app).post('/api/orders/10/claim').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('claim_failed');
    expect(res.body.message).toMatch('op_does_not_exist');
  });
});
