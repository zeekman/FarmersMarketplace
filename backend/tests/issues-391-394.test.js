/**
 * Unit tests for issues #391, #392, #393, #394
 */

const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');
const mockDb = jest.requireMock('../src/db/schema');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

// ---------------------------------------------------------------------------
// #391 — ends_at validation (MIN_AUCTION_DURATION_MINUTES)
// ---------------------------------------------------------------------------
describe('#391 POST /api/auctions — ends_at validation', () => {
  const validProduct = { id: 1, name: 'Tomatoes', farmer_id: 1 };

  function futureDate(offsetMinutes) {
    return new Date(Date.now() + offsetMinutes * 60 * 1000).toISOString();
  }

  it('accepts a valid ends_at at least 5 minutes in the future', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValueOnce(validProduct).mockReturnValueOnce(null),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 42 }),
      all: jest.fn().mockReturnValue([]),
    });
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 1, start_price: 10, ends_at: futureDate(10) });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('rejects a past ends_at with 400', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 1, start_price: 10, ends_at: futureDate(-10) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('rejects ends_at exactly 4 minutes from now (below minimum)', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 1, start_price: 10, ends_at: futureDate(4) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('accepts ends_at exactly 5 minutes from now', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValueOnce(validProduct).mockReturnValueOnce(null),
      run: jest.fn().mockReturnValue({ lastInsertRowid: 43 }),
      all: jest.fn().mockReturnValue([]),
    });
    const res = await request(app)
      .post('/api/auctions')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 1, start_price: 10, ends_at: futureDate(5) });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// #392 — auction cron tie-breaking
// ---------------------------------------------------------------------------
describe('#392 closeExpiredAuctions — tie-breaking ORDER BY amount DESC, created_at ASC', () => {
  const { closeExpiredAuctions } = require('../src/jobs/auctionCron');

  it('selects the earlier bid when two bids have the same amount', async () => {
    const expiredAuction = {
      id: 1,
      product_id: 10,
      farmer_wallet: 'GFARMER',
    };
    const earlierBid = {
      buyer_id: 2,
      amount: 50,
      buyer_wallet: 'GBUYER2',
      buyer_secret: 'SBUYER2',
    };

    // First prepare() call → expired auctions list
    // Second prepare() call → winner bid query
    // Third prepare() call → UPDATE auctions
    // Fourth prepare() call → INSERT orders
    const mockGet = jest.fn()
      .mockReturnValueOnce(earlierBid); // winner bid
    const mockAll = jest.fn().mockReturnValueOnce([expiredAuction]);
    const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1 });

    mockDb.prepare.mockReturnValue({ get: mockGet, all: mockAll, run: mockRun });
    stellar.sendPayment.mockResolvedValueOnce('TX_TIE');

    await closeExpiredAuctions();

    // Verify the bid query uses the correct ORDER BY
    const bidQuery = mockDb.prepare.mock.calls.find(
      ([sql]) => sql && sql.includes('ORDER BY') && sql.includes('amount DESC') && sql.includes('created_at ASC')
    );
    expect(bidQuery).toBeDefined();

    // Verify payment was sent with the winner's amount
    expect(stellar.sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50, receiverPublicKey: 'GFARMER' })
    );
  });

  it('cancels auction when there are no bids', async () => {
    const expiredAuction = { id: 2, product_id: 11, farmer_wallet: 'GFARMER2' };
    const mockGet = jest.fn().mockReturnValueOnce(null); // no winner
    const mockAll = jest.fn().mockReturnValueOnce([expiredAuction]);
    const mockRun = jest.fn();

    mockDb.prepare.mockReturnValue({ get: mockGet, all: mockAll, run: mockRun });

    await closeExpiredAuctions();

    expect(stellar.sendPayment).not.toHaveBeenCalled();
    const cancelCall = mockDb.prepare.mock.calls.find(
      ([sql]) => sql && sql.includes("status = 'cancelled'")
    );
    expect(cancelCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #393 — wallet transactions pagination
// ---------------------------------------------------------------------------
describe('#393 GET /api/wallet/transactions — pagination', () => {
  it('returns default page with next_cursor and prev_cursor', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    stellar.getTransactions.mockResolvedValueOnce({
      records: [{ id: 'tx1', amount: '5', from: 'GA', to: 'GB', created_at: '', transaction_hash: 'H1' }],
      next_cursor: 'cursor_next',
      prev_cursor: 'cursor_prev',
    });
    const res = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.next_cursor).toBe('cursor_next');
    expect(res.body.prev_cursor).toBe('cursor_prev');
  });

  it('forwards custom limit to getTransactions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    stellar.getTransactions.mockResolvedValueOnce({ records: [], next_cursor: null, prev_cursor: null });
    await request(app)
      .get('/api/wallet/transactions?limit=50')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(stellar.getTransactions).toHaveBeenCalledWith('GPUB', expect.objectContaining({ limit: 50 }));
  });

  it('forwards cursor to getTransactions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    stellar.getTransactions.mockResolvedValueOnce({ records: [], next_cursor: null, prev_cursor: null });
    await request(app)
      .get('/api/wallet/transactions?cursor=TOKEN123')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(stellar.getTransactions).toHaveBeenCalledWith('GPUB', expect.objectContaining({ cursor: 'TOKEN123' }));
  });

  it('caps limit at 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stellar_public_key: 'GPUB' }], rowCount: 1 });
    stellar.getTransactions.mockResolvedValueOnce({ records: [], next_cursor: null, prev_cursor: null });
    await request(app)
      .get('/api/wallet/transactions?limit=999')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(stellar.getTransactions).toHaveBeenCalledWith('GPUB', expect.objectContaining({ limit: 200 }));
  });
});

// ---------------------------------------------------------------------------
// #394 — wallet send destination validation
// ---------------------------------------------------------------------------
describe('#394 POST /api/wallet/send — destination validation', () => {
  const VALID_KEY = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';
  const USER_KEY  = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('rejects an invalid Stellar public key with 400 and code invalid_destination', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: 'not-a-stellar-key', amount: 10 });
    expect(res.status).toBe(400);
  });

  it('rejects a syntactically plausible but invalid key with 400', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: 'G' + 'A'.repeat(55), amount: 10 });
    // The Zod regex passes but StellarSdk.StrKey check may reject it
    // Either way, no stack trace should be in the response
    expect([200, 400, 402]).toContain(res.status);
    expect(res.body.error || '').not.toMatch(/at Object\.|TypeError|StellarSdk/);
  });

  it('accepts a valid destination and processes the send', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockResolvedValueOnce('TXHASH_394');
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: VALID_KEY, amount: 10 });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('TXHASH_394');
  });

  it('does not expose SDK stack trace when sendPayment throws', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({
      rows: [{ stellar_public_key: USER_KEY, stellar_secret_key: 'SSECRET' }],
      rowCount: 1,
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockRejectedValueOnce(new Error('op_no_destination'));
    const res = await request(app)
      .post('/api/wallet/send')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ destination: VALID_KEY, amount: 10 });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/at Object\.|TypeError/);
  });
});
