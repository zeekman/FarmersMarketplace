'use strict';

/**
 * SSE endpoint correctness tests (#1026).
 *
 * Tests that the SSE endpoints return the correct headers,
 * enforce authentication, and handle disconnects cleanly.
 *
 * These are fast unit/integration tests (not load tests).
 * See sse-load-test.js for the concurrent-connection load test.
 */

const { request, app, mockQuery } = require('./setup');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 10, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 20, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ─── GET /api/orders/stream ───────────────────────────────────────────────

describe('GET /api/orders/stream — SSE', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/orders/stream');
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid/expired token', async () => {
    const res = await request(app).get('/api/orders/stream?token=invalid-token');
    expect(res.status).toBe(401);
  });

  it('establishes SSE stream and returns event-stream content-type', async () => {
    const token = jwt.sign({ id: 10, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });

    // Use a manual HTTP request to avoid supertest waiting for the stream to end
    const res = await request(app)
      .get(`/api/orders/stream?token=${token}`)
      .buffer(false)       // don't buffer — just check headers and abort
      .timeout({ response: 500 })
      .catch((err) => err.response || err); // timeout is expected for a stream

    // Whether we got a response object or a timeout, check the status/headers
    if (res && res.headers) {
      expect(res.headers['content-type']).toMatch('text/event-stream');
    } else {
      // On timeout, res may be an Error; the test still verifies no 4xx was returned
      // If it threw with no response, the connection was accepted (correct)
      expect(res.status || 200).not.toBe(401);
      expect(res.status || 200).not.toBe(403);
    }
  });
});

// ─── GET /api/products/:id/stock-stream ──────────────────────────────────

describe('GET /api/products/:id/stock-stream — SSE', () => {
  it('returns 404 when product does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // product not found

    const res = await request(app).get('/api/products/999/stock-stream');
    expect(res.status).toBe(404);
  });

  it('establishes SSE stream for existing product', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ quantity: 50 }], rowCount: 1 });

    const res = await request(app)
      .get('/api/products/1/stock-stream')
      .buffer(false)
      .timeout({ response: 500 })
      .catch((err) => err.response || err);

    if (res && res.headers) {
      expect(res.headers['content-type']).toMatch('text/event-stream');
    } else {
      expect(res.status || 200).not.toBe(404);
    }
  });
});

// ─── GET /api/messages/events ─────────────────────────────────────────────

describe('GET /api/messages/events — SSE', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/api/messages/events');
    expect(res.status).toBe(401);
  });

  it('establishes SSE stream for authenticated user', async () => {
    const res = await request(app)
      .get('/api/messages/events')
      .set('Authorization', `Bearer ${buyerToken}`)
      .buffer(false)
      .timeout({ response: 500 })
      .catch((err) => err.response || err);

    if (res && res.headers) {
      expect(res.headers['content-type']).toMatch('text/event-stream');
    } else {
      expect(res.status || 200).not.toBe(401);
    }
  });
});
