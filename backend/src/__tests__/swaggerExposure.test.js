const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('Swagger UI exposure and protection', () => {
  let app;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
    // We need to require app inside each test to pick up env changes
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('Swagger UI is available in non-production by default', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_API_DOCS;
    app = require('../app');
    
    const res = await request(app).get('/api/docs/');
    // swagger-ui-express returns 200 or 301/302 for the UI
    expect([200, 301, 302]).toContain(res.status);
    expect(res.headers['content-security-policy']).toContain("'unsafe-inline'");
  });

  test('Swagger UI returns 404 in production by default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_API_DOCS;
    app = require('../app');
    
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(404);
  });

  test('Swagger UI is available in production when ENABLE_API_DOCS=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_API_DOCS = 'true';
    app = require('../app');
    
    const res = await request(app).get('/api/docs/');
    expect([200, 301, 302]).toContain(res.status);
  });

  test('Swagger UI is disabled when ENABLE_API_DOCS=false', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_API_DOCS = 'false';
    app = require('../app');
    
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(404);
  });

  test('/api/docs.json is public in non-production', async () => {
    process.env.NODE_ENV = 'development';
    app = require('../app');
    
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
  });

  test('/api/docs.json is protected in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    app = require('../app');
    
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(401);
  });

  test('/api/docs.json is available to admins in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    
    // Mock DB for auth middleware
    const db = require('../db/schema');
    db.query = jest.fn().mockResolvedValue({ rows: [{ active: 1 }] });
    
    app = require('../app');
    
    const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/docs.json')
      .set('Authorization', `Bearer ${token}`);
      
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
  });

  test('/api/docs.json is forbidden for non-admins in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    
    // Mock DB for auth middleware
    const db = require('../db/schema');
    db.query = jest.fn().mockResolvedValue({ rows: [{ active: 1 }] });
    
    app = require('../app');
    
    const token = jwt.sign({ id: 2, role: 'buyer' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/docs.json')
      .set('Authorization', `Bearer ${token}`);
      
    expect(res.status).toBe(403);
  });
});
