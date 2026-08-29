/**
 * Tests for backend/src/routes/messages.js — issue #1000
 *
 * Covers sending a message, listing conversation history, the unread-count
 * endpoint before/after marking as read, and that a user can never read or
 * send as another account (every query is scoped by the authenticated
 * req.user.id from the verified JWT, never by a client-supplied id).
 */

const jwt = require('jsonwebtoken');
const { request, app, mockQuery } = require('./setup');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 10, role: 'buyer' }, SECRET);
const farmerToken = jwt.sign({ id: 20, role: 'farmer' }, SECRET);

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── POST /api/messages ────────────────────────────────────────────────────────
describe('POST /api/messages', () => {
  it('sends a message from an authenticated buyer to a farmer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 20 }], rowCount: 1 }) // receiver exists
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT RETURNING id
      .mockResolvedValueOnce({
        rows: [{ id: 1, sender_id: 10, receiver_id: 20, content: 'Hello!' }],
        rowCount: 1,
      }); // SELECT the inserted row

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ receiver_id: 20, content: 'Hello!' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(1);
  });

  it('sanitizes HTML in the message content before storing it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 20 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 });

    await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ receiver_id: 20, content: '<script>alert(1)</script>' });

    const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO messages'));
    expect(insertCall[1][3]).toBe('alert(1)');
  });

  it('always uses the authenticated user as sender, ignoring a spoofed sender_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 20 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });

    await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ sender_id: 999, receiver_id: 20, content: 'hi' });

    const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO messages'));
    expect(insertCall[1][0]).toBe(10); // buyerToken's id, not the spoofed 999
  });

  it('returns 400 when receiver_id or content is missing', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ content: 'no receiver' });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when the receiver does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ receiver_id: 9999, content: 'hi' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when messaging yourself', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 }); // "receiver" is self
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ receiver_id: 10, content: 'hi me' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/messages').send({ receiver_id: 20, content: 'hi' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/messages (conversation list) ──────────────────────────────────────
describe('GET /api/messages', () => {
  it("lists the authenticated user's conversations", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          other_user_id: 20,
          other_user_name: 'Farmer Joe',
          last_message: 'Hello!',
          unread_count: 0,
        },
      ],
      rowCount: 1,
    });

    const res = await request(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].other_user_name).toBe('Farmer Joe');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/messages');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/messages/:userId (conversation history) ───────────────────────────
describe('GET /api/messages/:userId', () => {
  it('returns messages exchanged with the given user, scoped to the caller', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // mark-as-read update
      .mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1 }) // count
      .mockResolvedValueOnce({
        rows: [
          { id: 1, sender_id: 10, receiver_id: 20, content: 'Hi' },
          { id: 2, sender_id: 20, receiver_id: 10, content: 'Hey back' },
        ],
        rowCount: 2,
      });

    const res = await request(app)
      .get('/api/messages/20')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);

    // The history query is always scoped by the authenticated caller's id
    // (from the verified JWT), never by anything the client can control —
    // so a user can never read another account's conversation.
    const historyCall = mockQuery.mock.calls.find(([sql]) => sql.includes('s.name as sender_name'));
    expect(historyCall[1]).toEqual([10, 20, 20, 0]);
  });

  it('returns 400 for a non-numeric userId', async () => {
    const res = await request(app)
      .get('/api/messages/not-a-number')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/messages/20');
    expect(res.status).toBe(401);
  });
});

// ── Unread count, before and after marking as read ─────────────────────────────
describe('unread-count lifecycle', () => {
  it('GET /api/messages/unread-count reflects unread messages before marking as read', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 });

    const res = await request(app)
      .get('/api/messages/unread-count')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('POST /:conversation_id/read marks messages read and returns the updated unread_count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // participant check
      .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // UPDATE read_at
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 }); // recomputed unread count

    const res = await request(app)
      .post('/api/messages/10/read')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(0);
  });

  it('POST /:conversation_id/read returns 404 for a conversation the caller was never part of', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no shared messages

    const res = await request(app)
      .post('/api/messages/999/read')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 for unread-count without auth', async () => {
    const res = await request(app).get('/api/messages/unread-count');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/messages/:id/read — cannot mark another account's message ──────
describe('PATCH /api/messages/:id/read', () => {
  it("marks the caller's own received message as read", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .patch('/api/messages/1/read')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);

    // Scoped by receiver_id = the authenticated caller — a user can never
    // mark a message addressed to someone else as read.
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[1]).toEqual([1, 20]);
  });

  it('returns 404 when the message does not belong to the caller (impersonation attempt)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no row matched receiver_id = caller

    const res = await request(app)
      .patch('/api/messages/1/read')
      .set('Authorization', `Bearer ${buyerToken}`); // not the actual receiver

    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric message id', async () => {
    const res = await request(app)
      .patch('/api/messages/not-a-number/read')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
  });
});
