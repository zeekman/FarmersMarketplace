'use strict';

const jwt = require('jsonwebtoken');
const { request, app, mockDb } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

const FARMER_ROUTES = [
  '/api/analytics/farmer',
  '/api/analytics/farmer/waitlist',
  '/api/analytics/farmer/forecast',
  '/api/analytics/farmer/demand-heatmap',
];

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  // auth middleware calls db.query to check active status
  mockDb.query.mockResolvedValue({ rows: [{ active: 1 }], rowCount: 1 });
});

describe('Analytics routes — authentication', () => {
  it.each(FARMER_ROUTES)('GET %s returns 401 without a token', async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(401);
  });

  it.each(FARMER_ROUTES)('GET %s returns 403 for buyers', async (route) => {
    const res = await request(app).get(route).set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});
