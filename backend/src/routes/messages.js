const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// POST /api/messages
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
    res.status(201).json({ success: true, data: msg[0] });
  } catch (e) {
    err(res, 500, 'Failed to send message: ' + e.message, 'server_error');
  }
});

// GET /api/messages/conversations
router.get('/conversations', auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT
         CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as other_user_id,
         u.name as other_user_name, u.avatar_url as other_user_avatar,
         m.content as last_message, m.created_at as last_message_at,
         (SELECT COUNT(*) FROM messages WHERE sender_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AND receiver_id = $1 AND read_at IS NULL) as unread_count
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

// GET /api/messages/:userId
router.get('/:userId', auth, async (req, res) => {
  const currentUserId = req.user.id;
  const otherUserId = parseInt(req.params.userId, 10);
  if (isNaN(otherUserId)) return err(res, 400, 'Invalid user ID', 'validation_error');

  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  try {
    await db.query(
      `UPDATE messages SET read_at = NOW() WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [otherUserId, currentUserId]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [currentUserId, otherUserId]
    );
    const total = parseInt(countRows[0].total);
    const pages = Math.ceil(total / limit);

    const { rows } = await db.query(
      `SELECT m.*, s.name as sender_name, r.name as receiver_name
       FROM messages m JOIN users s ON s.id = m.sender_id JOIN users r ON r.id = m.receiver_id
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

// PATCH /api/messages/:id/read
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

// GET /api/messages/unread/count
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
