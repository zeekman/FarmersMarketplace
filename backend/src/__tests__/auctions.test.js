'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const jwt = require('jsonwebtoken');
const request = require('supertest');

// Mock auth middleware to skip the DB active-user check
jest.mock('../middleware/auth', () => {
  const jwt = require('jsonwebtoken');
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, code: 'missing_token' });
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ success: false, code: 'invalid_token' });
    }
  };
});

// Override the global routes mock to include the auctions router
jest.mock('../routes', () => {
  const express = require('express');
  const router = express.Router();
  router.use('/api/auctions', require('../routes/auctions'));
  return router;
});

const app = require('../app');
const { validateBidRules } = require('../routes/auctions');
const mockDb = jest.requireMock('../db/schema');

const SECRET = process.env.JWT_SECRET;
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);
const buyer2Token = jwt.sign({ id: 3, role: 'buyer'  }, SECRET);

// ─── validateBidRules (pure unit tests) ──────────────────────────────────────

describe('validateBidRules', () => {
  const base = {
    id: 1,
    status: 'active',
    ends_at: new Date(Date.now() + 60_000).toISOString(),
    start_price: 10,
    current_bid: null,
    min_increment: 0,
    reserve_price: null,
    highest_bidder_id: null,
    farmer_id: 1,
  };

  it('returns ok:true for a valid first bid above start_price', () => {
    expect(validateBidRules(base, 2, 15)).toEqual({ ok: true });
  });

  it('returns not_found when auction is null', () => {
    const r = validateBidRules(null, 2, 15);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not_found');
    expect(r.status).toBe(404);
  });

  it('returns auction_cancelled for cancelled auction', () => {
    const r = validateBidRules({ ...base, status: 'cancelled' }, 2, 15);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('auction_cancelled');
    expect(r.status).toBe(400);
  });

  it('returns auction_closed for closed auction', () => {
    const r = validateBidRules({ ...base, status: 'closed' }, 2, 15);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('auction_closed');
  });

  it('returns auction_ended when ends_at is in the past', () => {
    const r = validateBidRules(
      { ...base, ends_at: new Date(Date.now() - 1000).toISOString() },
      2, 15
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe('auction_ended');
  });

  it('returns forbidden when farmer bids on own auction', () => {
    const r = validateBidRules(base, 1, 15); // farmer_id === buyerId
    expect(r.ok).toBe(false);
    expect(r.code).toBe('forbidden');
    expect(r.status).toBe(403);
  });

  it('returns bid_too_low when amount <= start_price (no current_bid)', () => {
    const r = validateBidRules(base, 2, 10);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('bid_too_low');
  });

  it('returns bid_too_low when amount <= current_bid', () => {
    const r = validateBidRules({ ...base, current_bid: 20 }, 2, 20);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('bid_too_low');
  });

  it('returns bid_below_increment when amount < current_bid + min_increment', () => {
    const r = validateBidRules({ ...base, current_bid: 20, min_increment: 5 }, 2, 24);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('bid_below_increment');
  });

  it('accepts bid exactly at current_bid + min_increment', () => {
    expect(validateBidRules({ ...base, current_bid: 20, min_increment: 5 }, 2, 25)).toEqual({ ok: true });
  });

  it('returns already_highest when buyer is already highest bidder', () => {
    const r = validateBidRules({ ...base, current_bid: 20, highest_bidder_id: 2 }, 2, 25);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('already_highest');
  });
});

// ─── HTTP endpoints ───────────────────────────────────────────────────────────

const activeAuction = {
  id: 1,
  product_id: 10,
  farmer_id: 1,
  start_price: 10,
  reserve_price: null,
  min_increment: 0,
  current_bid: null,
  highest_bidder_id: null,
  status: 'active',
  ends_at: new Date(Date.now() + 3_600_000).toISOString(),
  closed_at: null,
  created_at: new Date().toISOString(),
  product_name: 'Tomatoes',
  description: 'Fresh',
  unit: 'kg',
  farmer_name: 'Alice',
  bid_count: '0',
};

describe('POST /api/auctions', () => {
  const body = {
    product_id: 10,
    start_price: 10,
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
  };

  it('creates an auction for a farmer who owns the product', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 }) // product ownership
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // no active auction
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }); // INSERT

    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.auctionId).toBe(7);
  });

  it('returns 403 when a buyer tries to create an auction', async () => {
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(body);
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/auctions').send(body);
    expect(res.status).toBe(401);
  });

  it('returns 400 when ends_at is missing', async () => {
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ product_id: 10, start_price: 10 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when ends_at is in the past', async () => {
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ ...body, ends_at: new Date(Date.now() - 1000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when start_price is zero', async () => {
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ ...body, start_price: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when product does not belong to farmer', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // product not found
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send(body);
    expect(res.status).toBe(404);
  });

  it('returns 409 when an active auction already exists for the product', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 })  // product found
      .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });  // existing active auction
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });
});

describe('GET /api/auctions', () => {
  it('returns list of active auctions', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [activeAuction], rowCount: 1 });
    const res = await request(app).get('/api/auctions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].product_name).toBe('Tomatoes');
  });

  it('returns empty array when no active auctions', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/auctions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/auctions/:id', () => {
  it('returns auction detail', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [activeAuction], rowCount: 1 });
    const res = await request(app).get('/api/auctions/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 404 for unknown auction', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/auctions/999');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('POST /api/auctions/:id/bid', () => {
  // SQLite path: db.transaction wraps the bid logic
  beforeEach(() => {
    mockDb.isPostgres = false;
    // transaction mock: immediately invoke the callback
    mockDb.transaction.mockImplementation((fn) => () => fn());
  });

  it('places a valid bid', async () => {
    const auctionRow = { ...activeAuction, farmer_id: 1, current_bid: null, min_increment: 0, highest_bidder_id: null };
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue(auctionRow) }) // SELECT auction
      .mockReturnValueOnce({ run: jest.fn() })                              // INSERT bid
      .mockReturnValueOnce({ run: jest.fn() });                             // UPDATE auction

    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: 15 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.currentBid).toBe(15);
  });

  it('returns 403 when a farmer tries to bid', async () => {
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ amount: 15 });
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/auctions/1/bid').send({ amount: 15 });
    expect(res.status).toBe(401);
  });

  it('returns 400 when amount is missing', async () => {
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when amount is not positive', async () => {
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: -5 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when auction does not exist', async () => {
    mockDb.prepare.mockReturnValueOnce({ get: jest.fn().mockReturnValue(undefined) });
    const res = await request(app)
      .post('/api/auctions/999/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: 15 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns 400 when bid is too low', async () => {
    const auctionRow = { ...activeAuction, farmer_id: 1, current_bid: 20, min_increment: 0, highest_bidder_id: null };
    mockDb.prepare.mockReturnValueOnce({ get: jest.fn().mockReturnValue(auctionRow) });
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: 20 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bid_too_low');
  });

  it('returns 400 when bid is below min_increment', async () => {
    const auctionRow = { ...activeAuction, farmer_id: 1, current_bid: 20, min_increment: 5, highest_bidder_id: null };
    mockDb.prepare.mockReturnValueOnce({ get: jest.fn().mockReturnValue(auctionRow) });
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: 24 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bid_below_increment');
  });

  it('returns 400 when buyer is already the highest bidder', async () => {
    const auctionRow = { ...activeAuction, farmer_id: 1, current_bid: 20, min_increment: 0, highest_bidder_id: 2 };
    mockDb.prepare.mockReturnValueOnce({ get: jest.fn().mockReturnValue(auctionRow) });
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: 25 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('already_highest');
  });

  it('returns 403 when auction owner tries to bid', async () => {
    // farmer_id: 1, buyerId from farmerToken is also 1 — but farmerToken role is 'farmer'
    // so the role check fires first. Test with a buyer whose id matches farmer_id.
    const ownerBuyerToken = jwt.sign({ id: 1, role: 'buyer' }, SECRET);
    const auctionRow = { ...activeAuction, farmer_id: 1, current_bid: null, min_increment: 0, highest_bidder_id: null };
    mockDb.prepare.mockReturnValueOnce({ get: jest.fn().mockReturnValue(auctionRow) });
    const res = await request(app)
      .post('/api/auctions/1/bid')
      .set('Authorization', `Bearer ${ownerBuyerToken}`)
      .send({ amount: 15 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });
});
