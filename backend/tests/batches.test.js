/**
 * Tests for backend/src/routes/batches.js
 * Covers: batch creation, QR code generation, public batch lookup by UUID,
 * and invalid-UUID / unknown-UUID error handling.
 * Closes #1003
 */
const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const batchRow = {
  id: 1,
  uuid: VALID_UUID,
  farmer_id: 1,
  batch_code: 'BATCH-001',
  harvest_date: '2025-06-15',
  location: 'Nairobi',
  certifications: 'Organic',
  notes: 'First harvest',
  qr_code_url: 'data:image/png;base64,abc123',
  created_at: '2025-06-15T10:00:00Z',
};

// ============================================================================
// POST /api/batches — create a batch
// ============================================================================
describe('POST /api/batches', () => {
  it('creates a batch and returns uuid and qr_code_url', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [batchRow], rowCount: 1 });

    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ batch_code: 'BATCH-001', harvest_date: '2025-06-15', location: 'Nairobi', certifications: 'Organic' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uuid).toBe(VALID_UUID);
    expect(typeof res.body.data.qr_code_url).toBe('string');
  });

  it('returns 400 when batch_code is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ harvest_date: '2025-06-15' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when harvest_date is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ batch_code: 'BATCH-002' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for malformed harvest_date', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ batch_code: 'BATCH-003', harvest_date: '15/06/2025' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 409 on duplicate batch_code for the same farmer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const uniqueError = new Error('UNIQUE constraint failed');
    uniqueError.code = '23505';
    mockQuery.mockRejectedValueOnce(uniqueError);

    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ batch_code: 'BATCH-001', harvest_date: '2025-06-15' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('duplicate_batch_code');
  });

  it('returns 403 when a buyer tries to create a batch', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ batch_code: 'BATCH-001', harvest_date: '2025-06-15' });

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ batch_code: 'BATCH-001', harvest_date: '2025-06-15' });

    expect(res.status).toBe(401);
  });
});

// ============================================================================
// GET /api/batches — list farmer's batches
// ============================================================================
describe('GET /api/batches', () => {
  it('returns list of batches for the authenticated farmer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [batchRow], rowCount: 1 });

    const res = await request(app)
      .get('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].batch_code).toBe('BATCH-001');
  });

  it('returns 400 for invalid farmer_id query param', async () => {
    const res = await request(app)
      .get('/api/batches?farmer_id=abc')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 403 when buyer tries to list batches', async () => {
    const res = await request(app)
      .get('/api/batches')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// GET /api/batches/:batchId/verify — public unauthenticated lookup
// ============================================================================
describe('GET /api/batches/:batchId/verify', () => {
  it('returns public batch info for a valid UUID', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        batch_code: 'BATCH-001',
        harvest_date: '2025-06-15',
        certifications: 'Organic',
        farmer_name: 'Alice',
      }],
      rowCount: 1,
    });

    const res = await request(app).get(`/api/batches/${VALID_UUID}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.batch_code).toBe('BATCH-001');
    expect(res.body.data.farmer_name).toBe('Alice');
    expect(res.body.data.certified).toBe(true);
  });

  it('returns certified=false when certifications is empty', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        batch_code: 'BATCH-002',
        harvest_date: '2025-06-15',
        certifications: '',
        farmer_name: 'Bob',
      }],
      rowCount: 1,
    });

    const res = await request(app).get(`/api/batches/${VALID_UUID}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.data.certified).toBe(false);
  });

  it('returns 404 for an unknown UUID (valid format, not found)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    const res = await request(app).get(`/api/batches/${unknownUuid}/verify`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns 400 for an invalid UUID format', async () => {
    const res = await request(app).get('/api/batches/not-a-uuid/verify');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for a truncated UUID', async () => {
    const res = await request(app).get('/api/batches/550e8400-e29b/verify');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('is publicly accessible without authentication', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ batch_code: 'BATCH-001', harvest_date: '2025-06-15', certifications: 'Organic', farmer_name: 'Alice' }],
      rowCount: 1,
    });

    const res = await request(app).get(`/api/batches/${VALID_UUID}/verify`);
    expect(res.status).toBe(200);
  });
});
