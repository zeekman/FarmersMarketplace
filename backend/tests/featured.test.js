const jwt = require('jsonwebtoken');
const { request, app, mockGet, mockAll, mockRun } = require('./setup');

beforeEach(() => jest.clearAllMocks());

const SECRET      = process.env.JWT_SECRET || 'secret';
const adminToken  = jwt.sign({ id: 9, role: 'admin'  }, SECRET);
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken  = jwt.sign({ id: 2, role: 'buyer'  }, SECRET);

describe('PATCH /api/admin/products/:id/feature', () => {
  it('admin can feature a product', async () => {
    mockGet.mockReturnValueOnce({ id: 1, is_featured: 0 });
    mockRun.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .patch('/api/admin/products/1/feature')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ featured: true });

    expect(res.status).toBe(200);
    expect(res.body.is_featured).toBe(true);
  });

  it('admin can unfeature a product', async () => {
    mockGet.mockReturnValueOnce({ id: 1, is_featured: 1 });
    mockRun.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .patch('/api/admin/products/1/feature')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ featured: false });

    expect(res.status).toBe(200);
    expect(res.body.is_featured).toBe(false);
  });

  it('toggles featured when no body value provided', async () => {
    mockGet.mockReturnValueOnce({ id: 1, is_featured: 0 });
    mockRun.mockReturnValueOnce({ changes: 1 });

    const res = await request(app)
      .patch('/api/admin/products/1/feature')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.is_featured).toBe(true); // toggled from 0 → 1
  });

  it('returns 403 for farmers', async () => {
    const res = await request(app)
      .patch('/api/admin/products/1/feature')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ featured: true });
    expect(res.status).toBe(403);
  });

  it('returns 403 for buyers', async () => {
    const res = await request(app)
      .patch('/api/admin/products/1/feature')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ featured: true });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/admin/products/1/feature')
      .send({ featured: true });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown product', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .patch('/api/admin/products/9999/feature')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ featured: true });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/products', () => {
  it('admin can list all products', async () => {
    mockAll.mockReturnValueOnce([
      { id: 1, name: 'Apples', is_featured: 1, farmer_name: 'Alice' },
      { id: 2, name: 'Beans',  is_featured: 0, farmer_name: 'Bob'   },
    ]);
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].is_featured).toBe(1);
  });

  it('returns 403 for non-admins', async () => {
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/products — featured sort', () => {
  it('returns featured products first', async () => {
    mockGet.mockReturnValueOnce({ count: 2 }); // COUNT query
    mockAll.mockReturnValueOnce([
      { id: 1, name: 'Apples', is_featured: 1 },
      { id: 2, name: 'Beans',  is_featured: 0 },
    ]);
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data[0].is_featured).toBe(1);
    expect(res.body.data[1].is_featured).toBe(0);
  });
});
