/**
 * Tests for backend/src/routes/network.js
 * Covers: identity endpoint, peer registration (admin only, URL validation,
 * SSRF-style invalid-URL rejection), and federated product listing.
 * Closes #1001
 */
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34' }]),
  },
}));

const jwt = require('jsonwebtoken');
const { request, app, mockQuery, getCsrf } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const adminToken = jwt.sign({ id: 1, role: 'admin' }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

// We need to mock global fetch which network.js uses for peer verification
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

// ============================================================================
// GET /api/network/identity
// ============================================================================
describe('GET /api/network/identity', () => {
  it('returns name, version and public_key', async () => {
    const res = await request(app).get('/api/network/identity');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('FarmersMarketplace');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.public_key).toBe('string');
    expect(res.body.public_key).toHaveLength(64); // 32 bytes hex
  });

  it('is publicly accessible without authentication', async () => {
    const res = await request(app).get('/api/network/identity');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// POST /api/network/peers  (admin only)
// ============================================================================
describe('POST /api/network/peers', () => {
  const validPeerUrl = 'https://peer.example.com';
  const validIdentity = {
    name: 'PeerMarket',
    version: '1.0.0',
    public_key: 'a'.repeat(64),
  };

  it('registers a valid peer after successful identity verification', async () => {
    const { token: csrf, cookieStr } = await getCsrf();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validIdentity,
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT (upsert)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            url: validPeerUrl,
            name: 'PeerMarket',
            public_key: 'a'.repeat(64),
            created_at: new Date().toISOString(),
          },
        ],
        rowCount: 1,
      }); // SELECT after upsert

    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: validPeerUrl });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.peer.url).toBe(validPeerUrl);
  });

  it('returns 400 when url is missing', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('rejects loopback and private IP addresses before making a server-side fetch', async () => {
    const privateUrls = ['http://127.0.0.1:8080', 'http://10.0.0.5', 'http://[::1]'];

    for (const url of privateUrls) {
      const { token: csrf, cookieStr } = await getCsrf();
      const res = await request(app)
        .post('/api/network/peers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Cookie', cookieStr)
        .set('X-CSRF-Token', csrf)
        .send({ url });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_error');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects non-HTTP(S) peer URLs', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-URL string (SSRF-style invalid input)', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('returns 502 when peer identity endpoint is unreachable', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: 'https://unreachable.example.com' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('peer_unreachable');
  });

  it('returns 502 when peer returns invalid identity (missing public_key)', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'BadPeer' }), // missing public_key
    });

    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: 'https://badpeer.example.com' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('peer_invalid_identity');
  });

  it('returns 403 when a non-admin tries to register a peer', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/network/peers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: validPeerUrl });

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post('/api/network/peers')
      .set('Cookie', cookieStr)
      .set('X-CSRF-Token', csrf)
      .send({ url: validPeerUrl });

    expect(res.status).toBe(401);
  });
});

// ============================================================================
// GET /api/network/peers/:peerId/products
// ============================================================================
describe('GET /api/network/peers/:peerId/products', () => {
  const cache = jest.requireMock('../src/cache');
  const buyerAuthToken = jwt.sign({ id: 2, role: 'buyer' }, SECRET);

  it('returns federated products from a known peer', async () => {
    cache.get.mockResolvedValueOnce(null); // no cache
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, url: 'https://peer.example.com', name: 'PeerMarket', public_key: 'a'.repeat(64) },
      ],
      rowCount: 1,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 10, name: 'Tomatoes', price: 2.5 }] }),
    });

    const res = await request(app)
      .get('/api/network/peers/1/products')
      .set('Authorization', `Bearer ${buyerAuthToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].source).toBe('federated');
    expect(res.body.data[0].peer_name).toBe('PeerMarket');
  });

  it('returns cached federated products when cache is warm', async () => {
    const cachedProducts = [
      { id: 10, name: 'Tomatoes', source: 'federated', peer_id: 1, peer_name: 'PeerMarket' },
    ];
    cache.get.mockResolvedValueOnce(cachedProducts);

    const res = await request(app)
      .get('/api/network/peers/1/products')
      .set('Authorization', `Bearer ${buyerAuthToken}`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.data).toEqual(cachedProducts);
  });

  it('returns 404 for an unknown peer id', async () => {
    cache.get.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get('/api/network/peers/9999/products')
      .set('Authorization', `Bearer ${buyerAuthToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('peer_not_found');
  });

  it('returns 502 when peer products endpoint fails', async () => {
    cache.get.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, url: 'https://peer.example.com', name: 'PeerMarket', public_key: 'a'.repeat(64) },
      ],
      rowCount: 1,
    });
    mockFetch.mockRejectedValueOnce(new Error('Peer timeout'));

    const res = await request(app)
      .get('/api/network/peers/1/products')
      .set('Authorization', `Bearer ${buyerAuthToken}`);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('peer_fetch_error');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/network/peers/1/products');
    expect(res.status).toBe(401);
  });
});
