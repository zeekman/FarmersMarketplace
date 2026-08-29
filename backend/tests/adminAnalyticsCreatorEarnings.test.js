'use strict';

const { request, app, mockQuery } = require('./setup');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const adminToken = jwt.sign({ id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 3, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

const ACTIVE_USER_ROW = { rows: [{ active: 1 }], rowCount: 1 };

describe('GET /api/admin/analytics/creator-earnings', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('401 if no token provided', async () => {
    const res = await request(app).get('/api/admin/analytics/creator-earnings');
    expect(res.status).toBe(401);
  });

  test('403 if the caller is not an admin (buyer)', async () => {
    mockQuery.mockResolvedValueOnce(ACTIVE_USER_ROW); // auth active-check
    const res = await request(app)
      .get('/api/admin/analytics/creator-earnings')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  test('403 if the caller is not an admin (farmer)', async () => {
    mockQuery.mockResolvedValueOnce(ACTIVE_USER_ROW); // auth active-check
    const res = await request(app)
      .get('/api/admin/analytics/creator-earnings')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('200 — admin request returns the expected aggregate shape', async () => {
    mockQuery
      .mockResolvedValueOnce(ACTIVE_USER_ROW) // auth active-check
      .mockResolvedValueOnce({
        rows: [{ total_credited: 100, total_claimed: 60, total_platform_fee: 5 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { day: '2026-07-01', event_type: 'credit', amount: 100, fee_amount: 5 },
          { day: '2026-07-02', event_type: 'claim', amount: 60, fee_amount: 0 },
        ],
        rowCount: 2,
      });

    const res = await request(app)
      .get('/api/admin/analytics/creator-earnings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      total_credited_xlm: 100,
      total_claimed_xlm: 60,
      total_platform_fee_xlm: 5,
      time_series: [
        { day: '2026-07-01', credited: 100, claimed: 0, platform_fee: 5 },
        { day: '2026-07-02', credited: 0, claimed: 60, platform_fee: 0 },
      ],
    });
  });
});
