const jwt = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun } = require('./setup');
const mailer = jest.requireMock('../src/utils/mailer');

beforeEach(() => jest.clearAllMocks());

const SECRET     = process.env.JWT_SECRET || 'secret';
const buyerToken = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);
const adminToken = jwt.sign({ id: 9, role: 'admin'  }, SECRET);
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);

const paidOrder = { id: 10, buyer_id: 2, product_id: 5, quantity: 2, total_price: 10, status: 'paid' };
const SECRET = process.env.JWT_SECRET || 'secret';
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);
const adminToken = jwt.sign({ id: 9, role: 'admin' }, SECRET);
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);

const paidOrder = {
  id: 10,
  buyer_id: 2,
  product_id: 5,
  quantity: 2,
  total_price: 10,
  status: 'paid',
};

describe('POST /api/disputes', () => {
  it('buyer files a dispute on a paid order', async () => {
    mockGet
      .mockReturnValueOnce(paidOrder)   // order lookup
      .mockReturnValueOnce(undefined);  // no existing dispute
      .mockReturnValueOnce(paidOrder) // order lookup
      .mockReturnValueOnce(undefined); // no existing dispute
    mockRun.mockReturnValueOnce({ lastInsertRowid: 1 });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 10, reason: 'Goods not delivered' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(res.body.id).toBe(1);
  });

  it('returns 403 for farmers', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ order_id: 10, reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/disputes').send({ order_id: 10, reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for order not belonging to buyer', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 999, reason: 'test' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-paid order', async () => {
    mockGet.mockReturnValueOnce({ ...paidOrder, status: 'pending' });
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 10, reason: 'test' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when dispute already exists for order', async () => {
    mockGet
      .mockReturnValueOnce(paidOrder)
      .mockReturnValueOnce({ id: 5 }); // existing dispute
    mockGet.mockReturnValueOnce(paidOrder).mockReturnValueOnce({ id: 5 }); // existing dispute
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 10, reason: 'test' });
    expect(res.status).toBe(409);
  });

  it('returns 400 for missing reason', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ order_id: 10 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/disputes', () => {
  it('admin can list all disputes', async () => {
    mockAll.mockReturnValueOnce([{ id: 1, status: 'open', reason: 'Not delivered' }]);
    const res = await request(app)
      .get('/api/disputes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .get('/api/disputes')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for farmers', async () => {
    const res = await request(app)
      .get('/api/disputes')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/disputes/:id', () => {
  it('admin moves dispute from open to under_review', async () => {
    mockGet.mockReturnValueOnce({ id: 1, status: 'open', buyer_id: 2, order_id: 10, resolution: null });
    mockGet.mockReturnValueOnce({
      id: 1,
      status: 'open',
      buyer_id: 2,
      order_id: 10,
      resolution: null,
    });
    mockRun.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .patch('/api/disputes/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'under_review' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('under_review');
  });

  it('admin resolves dispute with resolution note and triggers email', async () => {
    mockGet
      .mockReturnValueOnce({ id: 1, status: 'under_review', buyer_id: 2, order_id: 10, resolution: null })
      .mockReturnValueOnce({ id: 2, email: 'buyer@test.com', name: 'Buyer' })  // buyer
      .mockReturnValueOnce({ id: 10, product_id: 5 })                          // order
      .mockReturnValueOnce({ id: 5, name: 'Apples' });                         // product
      .mockReturnValueOnce({
        id: 1,
        status: 'under_review',
        buyer_id: 2,
        order_id: 10,
        resolution: null,
      })
      .mockReturnValueOnce({ id: 2, email: 'buyer@test.com', name: 'Buyer' }) // buyer
      .mockReturnValueOnce({ id: 10, product_id: 5 }) // order
      .mockReturnValueOnce({ id: 5, name: 'Apples' }); // product
    mockRun.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .patch('/api/disputes/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', resolution: 'Refund issued to buyer' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    // Email is fire-and-forget, just verify it was called
    await new Promise(r => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 10));
    expect(mailer.sendDisputeResolvedEmail).toHaveBeenCalled();
  });

  it('returns 400 when resolving without a resolution note', async () => {
    mockGet.mockReturnValueOnce({ id: 1, status: 'under_review', buyer_id: 2, order_id: 10 });
    const res = await request(app)
      .patch('/api/disputes/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status transition (open → resolved)', async () => {
    mockGet.mockReturnValueOnce({ id: 1, status: 'open', buyer_id: 2, order_id: 10 });
    const res = await request(app)
      .patch('/api/disputes/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', resolution: 'some note' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when trying to update a resolved dispute', async () => {
    mockGet.mockReturnValueOnce({ id: 1, status: 'resolved', buyer_id: 2, order_id: 10 });
    const res = await request(app)
      .patch('/api/disputes/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'open' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown dispute', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .patch('/api/disputes/9999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'under_review' });
    expect(res.status).toBe(404);
  });

  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .patch('/api/disputes/1')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ status: 'under_review' });
    expect(res.status).toBe(403);
  });
});
