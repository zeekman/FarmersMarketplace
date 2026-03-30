const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendDisputeResolvedEmail } = require('../utils/mailer');

// POST /api/disputes — buyer files a dispute on a paid order
router.post('/', auth, validate.dispute, (req, res) => {
  if (req.user.role !== 'buyer')
    return res.status(403).json({ error: 'Only buyers can file disputes' });

  const order_id = parseInt(req.body.order_id, 10);
  const { reason } = req.body;

  // Verify the order exists, belongs to this buyer, and is paid
  const order = db.prepare(
    'SELECT * FROM orders WHERE id = ? AND buyer_id = ?'
  ).get(order_id, req.user.id);
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?')
    .get(order_id, req.user.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'paid')
    return res.status(400).json({ error: 'Disputes can only be filed on paid orders' });

  // Enforce one dispute per order
  const existing = db.prepare('SELECT id FROM disputes WHERE order_id = ?').get(order_id);
  if (existing) return res.status(409).json({ error: 'A dispute already exists for this order' });

  const result = db.prepare(
    'INSERT INTO disputes (order_id, buyer_id, reason) VALUES (?, ?, ?)'
  ).run(order_id, req.user.id, reason.trim());

  res.status(201).json({ id: result.lastInsertRowid, order_id, status: 'open', message: 'Dispute filed' });
  const result = db
    .prepare('INSERT INTO disputes (order_id, buyer_id, reason) VALUES (?, ?, ?)')
    .run(order_id, req.user.id, reason.trim());

  res
    .status(201)
    .json({ id: result.lastInsertRowid, order_id, status: 'open', message: 'Dispute filed' });
});

// GET /api/disputes — admin lists all disputes (with order + buyer info)
router.get('/', auth, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admins only' });

  const disputes = db.prepare(`
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

  const disputes = db
    .prepare(
      `
    SELECT d.*, u.name as buyer_name, u.email as buyer_email,
           o.total_price, o.quantity, p.name as product_name
    FROM disputes d
    JOIN users u ON d.buyer_id = u.id
    JOIN orders o ON d.order_id = o.id
    JOIN products p ON o.product_id = p.id
    ORDER BY d.created_at DESC
  `).all();
  `
    )
    .all();

  res.json(disputes);
});

// PATCH /api/disputes/:id — admin resolves a dispute
router.patch('/:id', auth, validate.resolveDispute, async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admins only' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const { status, resolution } = req.body;

  // Enforce valid status transitions: open → under_review → resolved
  const transitions = { open: ['under_review'], under_review: ['resolved'], resolved: [] };
  if (!transitions[dispute.status].includes(status))
    return res.status(400).json({ error: `Cannot transition from '${dispute.status}' to '${status}'` });

  if (status === 'resolved' && (!resolution || !resolution.trim()))
    return res.status(400).json({ error: 'A resolution note is required when resolving a dispute' });

  db.prepare(
    'UPDATE disputes SET status = ?, resolution = ? WHERE id = ?'
  ).run(status, resolution ? resolution.trim() : dispute.resolution, dispute.id);
    return res
      .status(400)
      .json({ error: `Cannot transition from '${dispute.status}' to '${status}'` });

  if (status === 'resolved' && (!resolution || !resolution.trim()))
    return res
      .status(400)
      .json({ error: 'A resolution note is required when resolving a dispute' });

  db.prepare('UPDATE disputes SET status = ?, resolution = ? WHERE id = ?').run(
    status,
    resolution ? resolution.trim() : dispute.resolution,
    dispute.id
  );

  // Send email notification to buyer when resolved
  if (status === 'resolved') {
    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(dispute.buyer_id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(dispute.order_id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);

    sendDisputeResolvedEmail({
      dispute: { ...dispute, resolution: resolution.trim() },
      order,
      product,
      buyer,
    }).catch(err => console.error('Dispute email failed:', err.message));
    }).catch((err) => console.error('Dispute email failed:', err.message));
  }

  res.json({ id: dispute.id, status, message: 'Dispute updated' });
});

module.exports = router;
