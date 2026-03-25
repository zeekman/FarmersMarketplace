const jwt = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun } = require('./setup');

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || 'secret';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

describe('GET /api/products', () => {
  it('returns paginated product list', async () => {
    mockGet.mockReturnValueOnce({ count: 0 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/products', () => {
  it('farmer can create a product', async () => {
    mockRun.mockReturnValueOnce({ lastInsertRowid: 5 });
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ name: 'Tomatoes', price: 2.5, quantity: 100, unit: 'kg' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
  });

  it('buyer cannot create a product', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ name: 'Tomatoes', price: 2.5, quantity: 100 });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/products').send({ name: 'X', price: 1, quantity: 1 });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ price: 1, quantity: 1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/products/:id', () => {
  it('returns 404 for unknown product', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app).get('/api/products/9999');
    expect(res.status).toBe(404);
  });

  it('returns product details', async () => {
    mockGet.mockReturnValueOnce({ id: 1, name: 'Carrots', price: 1.0, farmer_name: 'Alice' });
    const res = await request(app).get('/api/products/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Carrots');
  });
});

describe('GET /api/products/mine/list', () => {
  it('returns farmer\'s own products', async () => {
    mockAll.mockReturnValueOnce([{ id: 1, name: 'Beans' }]);
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/products/:id', () => {
  it('farmer can delete their own product', async () => {
    mockGet.mockReturnValueOnce({ id: 1, farmer_id: 1 });
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for another farmer\'s product', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .delete('/api/products/1')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });
});
