const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// SSE client registry: userId -> Set of response objects
const sseClients = new Map();

function notifyUser(userId, event, data) {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch {}
  }
}

// POST /api/messages — send a message
router.post('/', auth, async (req, res) => {
  const { receiver_id, product_id, content } = req.body;
  const sender_id = req.user.id;

  if (!receiver_id || !content)
    return err(res, 400, 'receiver_id and content are required', 'validation_error');

  const sanitizedContent = content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
  if (!sanitizedContent)
    return err(res, 400, 'Message content cannot be empty', 'validation_error');

  const { rows: receiverRows } = await db.query('SELECT id FROM users WHERE id = $1', [
    receiver_id,
  ]);
  if (!receiverRows[0]) return err(res, 404, 'Receiver not found', 'not_found');
  if (sender_id === receiver_id)
    return err(res, 400, 'Cannot send message to yourself', 'validation_error');

  try {
    const { rows } = await db.query(
      'INSERT INTO messages (sender_id, receiver_id, product_id, content) VALUES ($1,$2,$3,$4) RETURNING id',
      [sender_id, receiver_id, product_id || null, sanitizedContent]
    );
    const { rows: msg } = await db.query('SELECT * FROM messages WHERE id = $1', [rows[0].id]);
    const message = msg[0];

    notifyUser(receiver_id, 'new_message', message);

    res.status(201).json({ success: true, data: message });
  } catch (e) {
    err(res, 500, 'Failed to send message: ' + e.message, 'server_error');
  }
});

// GET /api/messages — conversations sorted by last_message_at DESC
router.get('/', auth, async (req, res) => {
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

// GET /api/messages/events — SSE stream, delivers new_message events to authenticated user only
router.get('/events', auth, (req, res) => {
  const userId = req.user.id;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
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
      `UPDATE messages SET read_at = NOW()
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
    await db.query(
      `UPDATE messages SET read_at = NOW()
       WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [otherUserId, currentUserId]
    );

    // Scope: only return messages where current user is sender or receiver
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [currentUserId, otherUserId]
    );
    const total = parseInt(countRows[0].total);
    const pages = Math.ceil(total / limit);

    const { rows } = await db.query(
      `SELECT m.*, s.name as sender_name, r.name as receiver_name
       FROM messages m
       JOIN users s ON s.id = m.sender_id
       JOIN users r ON r.id = m.receiver_id
       WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [currentUserId, otherUserId, limit, offset]
    );
    res.json({ success: true, data: rows, page, limit, total, pages });
  } catch (e) {
    err(res, 500, 'Failed to fetch messages: ' + e.message, 'server_error');
  }
});

// PATCH /api/messages/:id/read — mark a single message as read (receiver-scoped)
router.patch('/:id/read', auth, async (req, res) => {
  const messageId = parseInt(req.params.id, 10);
  if (isNaN(messageId)) return err(res, 400, 'Invalid message ID', 'validation_error');

  try {
    const { rowCount } = await db.query(
      `UPDATE messages SET read_at = NOW() WHERE id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [messageId, req.user.id]
    );
    if (rowCount === 0) return err(res, 404, 'Message not found or already read', 'not_found');
    res.json({ success: true, message: 'Message marked as read' });
  } catch (e) {
    err(res, 500, 'Failed to mark message as read: ' + e.message, 'server_error');
  }
});

// GET /api/messages/unread/count — preserved for backward compatibility
router.get('/unread/count', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) as count FROM messages WHERE receiver_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ success: true, count: parseInt(rows[0].count) });
  } catch (e) {
    err(res, 500, 'Failed to fetch unread count: ' + e.message, 'server_error');
  }
});

module.exports = router;
