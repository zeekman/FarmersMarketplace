/**
 * Tests for backend/src/routes/cooperatives.js — issue #999
 *
 * cooperativeRoyalty.test.js (src/__tests__/) covers royalty-bps accounting.
 * This file covers the core membership CRUD lifecycle: create, join, leave,
 * list, and the route's authorization guards.
 */

process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'test-encryption-secret-for-jest';

const jwt = require('jsonwebtoken');
const { request, app, mockQuery } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, SECRET);
const farmer2Token = jwt.sign({ id: 2, role: 'farmer' }, SECRET);

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── POST /api/cooperatives ────────────────────────────────────────────────────
describe('POST /api/cooperatives', () => {
  it('creates a cooperative and adds the creator as its first admin member', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 }) // INSERT cooperatives RETURNING id
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });          // INSERT cooperative_members

    const res = await request(app)
      .post('/api/cooperatives')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ name: 'Green Valley Co-op' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(5);
    expect(res.body.publicKey).toBeTruthy();

    // Creator is inserted as an admin member of the new cooperative.
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO cooperative_members'),
      [5, 1]
    );
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/cooperatives')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/cooperatives').send({ name: 'No Auth Co-op' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/cooperatives ──────────────────────────────────────────────────────
describe('GET /api/cooperatives', () => {
  it('returns public member counts for ?farmer_id= without requiring auth', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: 'Green Valley', created_at: '2026-01-01', member_count: 3 }],
      rowCount: 1,
    });

    const res = await request(app).get('/api/cooperatives?farmer_id=1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].member_count).toBe(3);
  });

  it('returns 400 for a non-numeric farmer_id', async () => {
    const res = await request(app).get('/api/cooperatives?farmer_id=not-a-number');
    expect(res.status).toBe(400);
  });

  it('returns 401 when no farmer_id is given and the caller is unauthenticated', async () => {
    const res = await request(app).get('/api/cooperatives');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/cooperatives/:id/join ───────────────────────────────────────────
describe('POST /api/cooperatives/:id/join', () => {
  it('lets a farmer join an existing cooperative', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 }) // cooperative exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // not already a member
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });          // INSERT membership

    const res = await request(app)
      .post('/api/cooperatives/5/join')
      .set('Authorization', `Bearer ${farmer2Token}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when the cooperative does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/cooperatives/9999/join')
      .set('Authorization', `Bearer ${farmer2Token}`);

    expect(res.status).toBe(404);
  });

  it('rejects a duplicate join with 409', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 })   // cooperative exists
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }); // already a member

    const res = await request(app)
      .post('/api/cooperatives/5/join')
      .set('Authorization', `Bearer ${farmer2Token}`);

    expect(res.status).toBe(409);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/cooperatives/5/join');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/cooperatives/:id/leave ──────────────────────────────────────────
describe('POST /api/cooperatives/:id/leave', () => {
  it('lets a non-sole-admin member leave', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // caller is a member
      .mockResolvedValueOnce({ rows: [{ user_id: 99 }], rowCount: 1 })    // a different admin exists
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // DELETE membership

    const res = await request(app)
      .post('/api/cooperatives/5/leave')
      .set('Authorization', `Bearer ${farmer2Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when the caller is not a member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/cooperatives/5/leave')
      .set('Authorization', `Bearer ${farmer2Token}`);

    expect(res.status).toBe(404);
  });

  it('blocks the sole admin from leaving without transferring admin role first', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // caller is a member
      .mockResolvedValueOnce({ rows: [{ user_id: 1 }], rowCount: 1 });    // caller is the only admin

    const res = await request(app)
      .post('/api/cooperatives/5/leave')
      .set('Authorization', `Bearer ${farmerToken}`); // id 1

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('last_admin');
  });
});

// ── Authorization edge cases ──────────────────────────────────────────────────
describe('cooperative membership authorization edge cases', () => {
  it('PATCH /:id/admin — a non-admin member cannot transfer admin role to someone else', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // caller is not an admin

    const res = await request(app)
      .patch('/api/cooperatives/5/admin')
      .set('Authorization', `Bearer ${farmer2Token}`)
      .send({ new_admin_id: 3 });

    expect(res.status).toBe(403);
  });

  it('PATCH /:id/admin — rejects transferring to a user who is not a member', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // caller is admin
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                  // target is not a member

    const res = await request(app)
      .patch('/api/cooperatives/5/admin')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ new_admin_id: 999 });

    expect(res.status).toBe(404);
  });

  it('GET /:id/pending — a non-member cannot view pending transactions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // membership check fails

    const res = await request(app)
      .get('/api/cooperatives/5/pending')
      .set('Authorization', `Bearer ${farmer2Token}`);

    expect(res.status).toBe(403);
  });

  it('POST /:id/multisig-setup — a non-member cannot configure signers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // membership check fails

    const res = await request(app)
      .post('/api/cooperatives/5/multisig-setup')
      .set('Authorization', `Bearer ${farmer2Token}`)
      .send({ member_ids: [1, 2], threshold: 2 });

    expect(res.status).toBe(403);
  });
});
