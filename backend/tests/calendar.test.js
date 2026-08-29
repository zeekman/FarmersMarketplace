/**
 * Tests for backend/src/routes/calendar.js
 * Covers: creating recurring availability rules, querying calendar entries
 * for a date range, and validating malformed recurrence input.
 * Closes #1002
 */
const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

// Shared product ownership mock: product belongs to farmer id=1
const productRow = { farmer_id: 1 };

// A reusable calendar entry row
const calendarRow = {
  id: 10,
  available_from: '2025-06-02',
  available_until: '2025-06-08',
  recurrence: 'weekly',
  recurrence_end: '2025-08-31',
  delete_instance_date: null,
};

// ============================================================================
// POST /api/calendar — create availability rule
// ============================================================================
describe('POST /api/calendar', () => {
  it('creates a one-off (none) availability entry', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 }) // product ownership check
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }); // INSERT

    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '2025-07-01', recurrence: 'none' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(1);
  });

  it('creates a weekly recurring availability rule', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({
        product_id: 5,
        available_from: '2025-06-02',
        available_until: '2025-06-08',
        recurrence: 'weekly',
        recurrence_end: '2025-08-31',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('creates a biweekly recurring rule', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '2025-06-01', recurrence: 'biweekly' });

    expect(res.status).toBe(201);
  });

  it('creates a monthly recurring rule', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [productRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 4 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '2025-06-01', recurrence: 'monthly' });

    expect(res.status).toBe(201);
  });

  it('returns 400 when product_id is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ available_from: '2025-07-01' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when available_from is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for malformed available_from date (not YYYY-MM-DD)', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '01/07/2025' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for invalid recurrence value', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '2025-07-01', recurrence: 'daily' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 404 when product does not exist', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // product not found

    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 9999, available_from: '2025-07-01' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when farmer does not own the product', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    // Product is owned by farmer id=99, not id=1
    mockQuery.mockResolvedValueOnce({ rows: [{ farmer_id: 99 }], rowCount: 1 });

    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '2025-07-01' });

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/calendar')
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ product_id: 5, available_from: '2025-07-01' });

    expect(res.status).toBe(401);
  });
});

// ============================================================================
// GET /api/calendar — query calendar entries for a date range
// ============================================================================
describe('GET /api/calendar', () => {
  it('returns merged date ranges for a month with one non-recurring entry', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, available_from: '2025-07-05', available_until: '2025-07-10', recurrence: 'none', recurrence_end: null, delete_instance_date: null }],
      rowCount: 1,
    });

    const res = await request(app).get('/api/calendar?product_id=5&month=2025-07');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].from).toBe('2025-07-05');
    expect(res.body.data[0].until).toBe('2025-07-10');
  });

  it('expands weekly recurring entries within the queried month', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [calendarRow], // weekly, starting 2025-06-02
      rowCount: 1,
    });

    const res = await request(app).get('/api/calendar?product_id=5&month=2025-06');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // weekly from June 2 should produce multiple ranges in June
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty data when no entries exist for the month', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app).get('/api/calendar?product_id=5&month=2025-12');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 400 when product_id is missing', async () => {
    const res = await request(app).get('/api/calendar?month=2025-07');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 when month is missing', async () => {
    const res = await request(app).get('/api/calendar?product_id=5');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for malformed month (not YYYY-MM)', async () => {
    const res = await request(app).get('/api/calendar?product_id=5&month=July-2025');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('is publicly accessible without auth', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/calendar?product_id=5&month=2025-07');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// DELETE /api/calendar/:id — delete series or single instance
// ============================================================================
describe('DELETE /api/calendar/:id', () => {
  const calendarWithOwner = { ...calendarRow, farmer_id: 1 };

  it('deletes the whole series by default', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [calendarWithOwner], rowCount: 1 }) // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

    const res = await request(app)
      .delete('/api/calendar/10')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('deletes a single instance when delete_mode=instance', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery
      .mockResolvedValueOnce({ rows: [calendarWithOwner], rowCount: 1 }) // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE delete_instance_date

    const res = await request(app)
      .delete('/api/calendar/10?delete_mode=instance&instance_date=2025-06-09')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when instance_date is missing for instance delete', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [calendarWithOwner], rowCount: 1 });

    const res = await request(app)
      .delete('/api/calendar/10?delete_mode=instance')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 400 for malformed instance_date', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [calendarWithOwner], rowCount: 1 });

    const res = await request(app)
      .delete('/api/calendar/10?delete_mode=instance&instance_date=bad-date')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 404 for non-existent calendar entry', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete('/api/calendar/9999')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(404);
  });

  it('returns 403 when farmer does not own the calendar entry', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...calendarWithOwner, farmer_id: 99 }], rowCount: 1 });

    const res = await request(app)
      .delete('/api/calendar/10')
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .delete('/api/calendar/10')
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(401);
  });
});
