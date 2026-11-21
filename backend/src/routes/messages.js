const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const sseAuth = require('../middleware/sseAuth');
const { issueStreamTicket } = require('../middleware/sseAuth');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const realtime = require('../utils/realtime');
const createPerUserRateLimiter = require('../middleware/rateLimitPerUser');
const { parsePagination, sendPaginated } = require('../utils/pagination');
const sse = require('../utils/sse');

// BE-38: Message rate limits (30 messages/min, 200/day)
const messageRateLimitPerMinute = createPerUserRateLimiter(30, 60 * 1000);
const messageRateLimitPerDay = createPerUserRateLimiter(200, 24 * 60 * 60 * 1000);

// SSE client registry: userId -> Set of response objects (local to this process)
const sseClients = new Map();

function notifyUser(userId, event, data) {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // The client may disconnect between registry lookup and delivery.
    }
  }
}

// Deliver events published by any instance to this process's local subscribers.
realtime.subscribe('messages', (event, data) => {
  if (data && data.userId != null) notifyUser(data.userId, event, data.message);
});

// POST /api/messages — send a message
router.post('/', auth, messageRateLimitPerMinute, messageRateLimitPerDay, async (req, res) => {
  const { receiver_id, product_id, content } = req.body;
  const sender_id = req.user.id;

  if (!receiver_id || !content)
    return err(res, 400, 'receiver_id and content are required', 'validation_error');

  // BE-38: Check if sender is blocked by receiver
  const { rows: blockRows } = await db.query(
    'SELECT id FROM message_blocks WHERE user_id = $1 AND blocked_user_id = $2',
    [receiver_id, sender_id]
  );
  if (blockRows[0]) {
    return err(res, 403, 'You are blocked by this user', 'blocked');
  }

  // BE-38: Enforce 2,000 character limit
  if (content.length > 2000) {
    return err(res, 400, 'Message content cannot exceed 2,000 characters', 'validation_error');
  }

  const sanitizedContent = sanitizeText(content);
  if (!sanitizedContent)
    return err(res, 400, 'Message content cannot be empty', 'validation_error');

  const { rows: receiverRows } = await db.query('SELECT id FROM users WHERE id = $1', [
    receiver_id,
  ]);
  if (!receiverRows[0]) return err(res, 404, 'Receiver not found', 'not_found');
  if (sender_id === receiver_id)
    return err(res, 400, 'Cannot send message to yourself', 'validation_error');

  // BE-38: Authorization check - buyer can only message farmers with active listings or existing orders
  if (req.user.role === 'buyer') {
    const { rows: authRows } = await db.query(
      `SELECT 1 FROM (
        SELECT 1 FROM products WHERE farmer_id = $1 AND active = true
        UNION
        SELECT 1 FROM orders o
        JOIN products p ON o.product_id = p.id
        WHERE o.buyer_id = $2 AND p.farmer_id = $1
      ) AS authorized LIMIT 1`,
      [receiver_id, sender_id]
    );
    if (!authRows[0]) {
      return err(res, 403, 'You can only message farmers with active listings or with whom you have orders', 'unauthorized_messaging');
    }
  }

  try {
    const { rows } = await db.query(
      'INSERT INTO messages (sender_id, receiver_id, product_id, content) VALUES ($1,$2,$3,$4) RETURNING id',
      [sender_id, receiver_id, product_id || null, sanitizedContent]
    );
    const { rows: msg } = await db.query('SELECT * FROM messages WHERE id = $1', [rows[0].id]);
    const message = msg[0];

    realtime.publish('messages', 'new_message', { userId: receiver_id, message });

    res.status(201).json({ success: true, data: message });
  } catch (e) {
    err(res, 500, 'Failed to send message: ' + e.message, 'server_error');
  }
});

// GET /api/messages — conversations sorted by last_message_at DESC (paginated)
router.get('/', auth, async (req, res) => {
  const userId = req.user.id;
  const { page, limit, offset } = parsePagination(req);

  try {
    // Count total conversations
    const { rows: countRows } = await db.query(
      `SELECT COUNT(DISTINCT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END) as count
       FROM messages
       WHERE sender_id = $1 OR receiver_id = $1`,
      [userId]
    );
    const total = parseInt(countRows[0]?.count || 0, 10);

    const { rows } = await db.query(
      `SELECT
         CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as other_user_id,
         u.name as other_user_name, u.avatar_url as other_user_avatar,
         m.content as last_message, m.created_at as last_message_at,
         (SELECT COUNT(*) FROM messages
          WHERE sender_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
            AND receiver_id = $1 AND read_at IS NULL) as unread_count
       FROM messages m
       JOIN users u ON u.id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
       WHERE m.id IN (
         SELECT MAX(id) FROM messages WHERE sender_id = $1 OR receiver_id = $1
         GROUP BY CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END
       )
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    sendPaginated(res, req, rows, { page, limit, total });
  } catch (e) {
    err(res, 500, 'Failed to fetch conversations: ' + e.message, 'server_error');
  }
});

// GET /api/messages/unread-count — total unread count for authenticated user
router.get('/unread-count', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) as count FROM messages WHERE receiver_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ count: parseInt(rows[0].count) });
  } catch (e) {
    err(res, 500, 'Failed to fetch unread count: ' + e.message, 'server_error');
  }
});

// POST /api/messages/stream-ticket — mints a single-use, 60s ticket for opening the SSE stream.
// Bearer-authenticated, so the access token never has to be placed in a URL.
router.post('/stream-ticket', auth, (req, res) => {
  res.json(issueStreamTicket(req.user.id));
});

// GET /api/messages/events — SSE stream, delivers new_message events to authenticated user only.
// Browser EventSource can't set an Authorization header, so this accepts a single-use ticket
// from POST /messages/stream-ticket via ?ticket=. Tickets are consumed by the sseAuth middleware.
router.get('/events', sseAuth, (req, res) => {
  const userId = req.user.id;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
  const unregisterSse = sse.register(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // The client may disconnect while the heartbeat is being written.
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregisterSse();
    const clients = sseClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(userId);
    }
  });
});

// GET /api/messages/conversations — preserved for backward compatibility
router.get('/conversations', auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT
         CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as other_user_id,
         u.name as other_user_name, u.avatar_url as other_user_avatar,
         m.content as last_message, m.created_at as last_message_at,
         (SELECT COUNT(*) FROM messages
          WHERE sender_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
            AND receiver_id = $1 AND read_at IS NULL) as unread_count
       FROM messages m
       JOIN users u ON u.id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
       WHERE m.id IN (
         SELECT MAX(id) FROM messages WHERE sender_id = $1 OR receiver_id = $1
         GROUP BY CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END
       )
       ORDER BY m.created_at DESC`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    err(res, 500, 'Failed to fetch conversations: ' + e.message, 'server_error');
  }
});

// POST /api/messages/:conversation_id/read — mark all messages in a conversation as read
// conversation_id is the other participant's user ID
router.post('/:conversation_id/read', auth, async (req, res) => {
  const currentUserId = req.user.id;
  const otherUserId = parseInt(req.params.conversation_id, 10);
  if (isNaN(otherUserId)) return err(res, 400, 'Invalid conversation ID', 'validation_error');

  // Scope check: verify current user is a participant in this conversation
  const { rows: participantCheck } = await db.query(
    `SELECT id FROM messages
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
     LIMIT 1`,
    [currentUserId, otherUserId]
  );
  if (!participantCheck[0]) return err(res, 404, 'Conversation not found', 'not_found');

  try {
    await db.query(
      `UPDATE messages SET read_at = CURRENT_TIMESTAMP
       WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [otherUserId, currentUserId]
    );

    const { rows } = await db.query(
      `SELECT COUNT(*) as count FROM messages WHERE receiver_id = $1 AND read_at IS NULL`,
      [currentUserId]
    );
    res.json({ success: true, unread_count: parseInt(rows[0].count) });
  } catch (e) {
    err(res, 500, 'Failed to mark messages as read: ' + e.message, 'server_error');
  }
});

// GET /api/messages/:userId — messages between current user and another user (participant-scoped)
router.get('/:userId', auth, async (req, res) => {
  const currentUserId = req.user.id;
  const otherUserId = parseInt(req.params.userId, 10);
  if (isNaN(otherUserId)) return err(res, 400, 'Invalid user ID', 'validation_error');

  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  try {
    await db.query('SELECT id FROM users WHERE id = $1', [otherUserId]);
    const { rows } = await db.query(
      `SELECT * FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [currentUserId, otherUserId, limit, offset]
    );
    res.json({ success: true, data: rows.reverse() });
  } catch (e) {
    err(res, 500, 'Failed to fetch messages: ' + e.message, 'server_error');
  }
});

module.exports = router;

// POST /api/messages/block — block a user from sending messages
router.post('/block', auth, async (req, res) => {
  const { blocked_user_id } = req.body;
  if (!blocked_user_id) return err(res, 400, 'blocked_user_id is required', 'validation_error');
  if (blocked_user_id === req.user.id)
    return err(res, 400, 'Cannot block yourself', 'validation_error');

  try {
    await db.query(
      'INSERT INTO message_blocks (user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, blocked_user_id]
    );
    res.json({ success: true, message: 'User blocked successfully' });
  } catch (e) {
    err(res, 500, 'Failed to block user: ' + e.message, 'server_error');
  }
});

// DELETE /api/messages/block/:userId — unblock a user
router.delete('/block/:userId', auth, async (req, res) => {
  const blockedUserId = parseInt(req.params.userId, 10);
  if (isNaN(blockedUserId)) return err(res, 400, 'Invalid user ID', 'validation_error');

  try {
    await db.query(
      'DELETE FROM message_blocks WHERE user_id = $1 AND blocked_user_id = $2',
      [req.user.id, blockedUserId]
    );
    res.json({ success: true, message: 'User unblocked successfully' });
  } catch (e) {
    err(res, 500, 'Failed to unblock user: ' + e.message, 'server_error');
  }
});

// GET /api/messages/blocked — list blocked users
router.get('/blocked', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.blocked_user_id, u.name, u.avatar_url, b.created_at
       FROM message_blocks b
       JOIN users u ON b.blocked_user_id = u.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    err(res, 500, 'Failed to fetch blocked users: ' + e.message, 'server_error');
  }
});

// POST /api/messages/:messageId/report — report a message
router.post('/:messageId/report', auth, async (req, res) => {
  const messageId = parseInt(req.params.messageId, 10);
  if (isNaN(messageId)) return err(res, 400, 'Invalid message ID', 'validation_error');

  const { reason } = req.body;

  // Verify the message exists and the reporter is the receiver
  const { rows: msgRows } = await db.query(
    'SELECT id, receiver_id FROM messages WHERE id = $1',
    [messageId]
  );
  if (!msgRows[0]) return err(res, 404, 'Message not found', 'not_found');
  if (msgRows[0].receiver_id !== req.user.id) {
    return err(res, 403, 'You can only report messages sent to you', 'forbidden');
  }

  try {
    await db.query(
      'INSERT INTO message_reports (message_id, reporter_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [messageId, req.user.id, reason || null]
    );
    res.json({ success: true, message: 'Message reported successfully' });
  } catch (e) {
    err(res, 500, 'Failed to report message: ' + e.message, 'server_error');
  }
});
