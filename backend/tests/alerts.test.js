const jwt = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun, mockPrepare } = require('./setup');
const mailer = jest.requireMock('../src/utils/mailer');

beforeEach(() => jest.clearAllMocks());

const SECRET      = process.env.JWT_SECRET || 'secret';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

// ── Favourites ───────────────────────────────────────────────────────────────

describe('POST /api/alerts/favourites/:productId', () => {
  it('adds a product to favourites', async () => {
    const res = await request(app)
      .post('/api/alerts/favourites/10')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/favourites/i);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/alerts/favourites/10');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/alerts/favourites/:productId', () => {
  it('removes a product from favourites', async () => {
    const res = await request(app)
      .delete('/api/alerts/favourites/10')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/alerts/favourites', () => {
  it('lists user favourites', async () => {
    mockAll.mockReturnValueOnce([{ id: 10, name: 'Tomatoes' }]);
    const res = await request(app)
      .get('/api/alerts/favourites')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

// ── Waitlist ──────────────────────────────────────────────────────────────────

describe('POST /api/alerts/waitlist/:productId', () => {
  it('joins a waitlist', async () => {
    const res = await request(app)
      .post('/api/alerts/waitlist/10')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/waitlist/i);
  });
});

describe('DELETE /api/alerts/waitlist/:productId', () => {
  it('leaves a waitlist', async () => {
    const res = await request(app)
      .delete('/api/alerts/waitlist/10')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
  });
});

// ── Restock notifications ─────────────────────────────────────────────────────

describe('POST /api/products/:id/restock', () => {
  const outOfStockProduct = {
    id: 10, name: 'Tomatoes', quantity: 0, farmer_id: 1, restock_notified_at: null,
  };

  function setupRestockMocks({ product = outOfStockProduct, favBuyers = [], waitBuyers = [], userRows = [], subRow = null } = {}) {
    // Call order inside the route handler:
    //   1. get product (ownership check)
    //   2. run UPDATE quantity
    //   3. run UPDATE restock_notified_at
    //   4. all favourites
    //   5. all waitlists
    //   6+ get user per buyer, get push sub per buyer
    mockGet
      .mockReturnValueOnce(product);               // 1. product lookup

    mockRun
      .mockReturnValueOnce({ changes: 1 })         // 2. UPDATE quantity
      .mockReturnValueOnce({ changes: 1 });         // 3. UPDATE restock_notified_at

    mockAll
      .mockReturnValueOnce(favBuyers)              // 4. favourites
      .mockReturnValueOnce(waitBuyers);            // 5. waitlists

    // For each unique user: mockGet (user row) + mockGet (push sub)
    for (const user of userRows) {
      mockGet
        .mockReturnValueOnce(user)    // user row
        .mockReturnValueOnce(subRow); // push subscription
    }
  }

  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ quantity: 5 });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid quantity', async () => {
    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown product', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });
    expect(res.status).toBe(404);
  });

  it('sends email AND push to favourites + waitlist buyers on first restock', async () => {
    const buyer = { id: 2, name: 'Bob', email: 'bob@test.com' };
    setupRestockMocks({
      favBuyers:  [{ user_id: 2 }],
      waitBuyers: [],
      userRows:   [buyer],
      subRow:     { subscription_json: JSON.stringify({ endpoint: 'https://push.test', keys: {} }) },
    });

    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });

    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(1);

    // Give the fire-and-forget Promise.allSettled a tick to resolve.
    await new Promise(r => setImmediate(r));

    expect(mailer.sendBackInStockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ user: buyer, product: expect.objectContaining({ id: 10 }) })
    );
    expect(mailer.sendPushToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: 'Back in stock' }),
      })
    );
  });

  it('deduplicates buyer IDs across favourites and waitlists', async () => {
    const buyer = { id: 2, name: 'Bob', email: 'bob@test.com' };
    // Buyer 2 appears in both favourites and waitlists — should only be notified once.
    setupRestockMocks({
      favBuyers:  [{ user_id: 2 }],
      waitBuyers: [{ user_id: 2 }],
      userRows:   [buyer], // only one user lookup expected
      subRow:     null,
    });

    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });

    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(1); // deduplicated: 1, not 2

    await new Promise(r => setImmediate(r));
    expect(mailer.sendBackInStockEmail).toHaveBeenCalledTimes(1);
  });

  it('does NOT notify on double-restock (restock_notified_at already set)', async () => {
    const alreadyNotified = { ...outOfStockProduct, restock_notified_at: '2026-06-01T00:00:00Z' };
    mockGet.mockReturnValueOnce(alreadyNotified);
    mockRun.mockReturnValueOnce({ changes: 1 }); // UPDATE quantity

    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });

    expect(res.status).toBe(200);
    expect(res.body.notified).toBeUndefined(); // no notification path taken

    await new Promise(r => setImmediate(r));
    expect(mailer.sendBackInStockEmail).not.toHaveBeenCalled();
    expect(mailer.sendPushToUser).not.toHaveBeenCalled();
  });

  it('does NOT notify when product was already in stock', async () => {
    const inStock = { ...outOfStockProduct, quantity: 5, restock_notified_at: null };
    mockGet.mockReturnValueOnce(inStock);
    mockRun.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .post('/api/products/10/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(mailer.sendBackInStockEmail).not.toHaveBeenCalled();
  });
});
