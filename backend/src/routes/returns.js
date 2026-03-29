const router = require('express').Router({ mergeParams: true });
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { sendPayment } = require('../utils/stellar');
const { err } = require('../middleware/error');
const { sendReturnEmail } = require('../utils/mailer');

const RETURN_WINDOW_HOURS = 48;

// POST /api/orders/:id/return — buyer files a return request
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can file returns', 'forbidden');

  const { reason } = req.body;
  if (!reason || !reason.trim()) return err(res, 400, 'reason is required', 'validation_error');

  const { rows: oRows } = await db.query(
    `SELECT o.*, p.farmer_id, p.name as product_name,
            u.name as farmer_name, u.email as farmer_email
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     WHERE o.id = $1 AND o.buyer_id = $2`,
    [req.params.id, req.user.id]
  );
  const order = oRows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (order.status !== 'delivered') return err(res, 400, 'Returns can only be filed for delivered orders', 'invalid_state');

  const deliveredAt = new Date(order.updated_at || order.created_at);
  const hoursElapsed = (Date.now() - deliveredAt.getTime()) / 3600000;
  if (hoursElapsed > RETURN_WINDOW_HOURS) {
    return err(res, 400, `Return window of ${RETURN_WINDOW_HOURS} hours has passed`, 'return_window_expired');
  }

  // Only one return per order
  const { rows: existing } = await db.query(
    'SELECT id FROM return_requests WHERE order_id = $1', [req.params.id]
  );
  if (existing[0]) return err(res, 409, 'A return request already exists for this order', 'conflict');

  const { rows: buyerRows } = await db.query('SELECT name, email FROM users WHERE id = $1', [req.user.id]);
  const buyer = buyerRows[0];

  const { rows } = await db.query(
    'INSERT INTO return_requests (order_id, buyer_id, reason) VALUES ($1, $2, $3) RETURNING id',
    [req.params.id, req.user.id, reason.trim()]
  );

  sendReturnEmail({
    type: 'filed',
    order,
    buyer,
    farmer: { name: order.farmer_name, email: order.farmer_email },
    reason: reason.trim(),
  }).catch(e => console.error('[Return] Email failed:', e.message));

  res.json({ success: true, returnRequestId: rows[0].id, message: 'Return request filed' });
});

// PATCH /api/orders/:id/return/approve — farmer approves and triggers refund
router.patch('/approve', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can approve returns', 'forbidden');

  const { rows: rRows } = await db.query(
    `SELECT rr.*, o.total_price, o.buyer_id,
            u_buyer.stellar_public_key as buyer_wallet, u_buyer.name as buyer_name, u_buyer.email as buyer_email,
            u_farmer.stellar_secret_key as farmer_secret,
            p.name as product_name
     FROM return_requests rr
     JOIN orders o ON rr.order_id = o.id
     JOIN products p ON o.product_id = p.id
     JOIN users u_buyer ON rr.buyer_id = u_buyer.id
     JOIN users u_farmer ON p.farmer_id = u_farmer.id
     WHERE rr.order_id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const rr = rRows[0];
  if (!rr) return err(res, 404, 'Return request not found or not yours', 'not_found');
  if (rr.status !== 'pending') return err(res, 400, `Return request is already ${rr.status}`, 'invalid_state');

  let txHash;
  try {
    txHash = await sendPayment({
      senderSecret: rr.farmer_secret,
      receiverPublicKey: rr.buyer_wallet,
      amount: parseFloat(rr.total_price),
      memo: `Refund#${req.params.id}`.slice(0, 28),
    });
  } catch (e) {
    return res.status(402).json({ success: false, message: 'Refund payment failed: ' + e.message, code: 'refund_failed' });
  }

  await db.query(
    'UPDATE return_requests SET status = $1, refund_tx_hash = $2 WHERE order_id = $3',
    ['approved', txHash, req.params.id]
  );

  sendReturnEmail({
    type: 'approved',
    order: { id: req.params.id, total_price: rr.total_price, product_name: rr.product_name },
    buyer: { name: rr.buyer_name, email: rr.buyer_email },
    txHash,
  }).catch(e => console.error('[Return] Email failed:', e.message));

  res.json({ success: true, txHash, message: 'Return approved and refund sent' });
});

// PATCH /api/orders/:id/return/reject — farmer rejects with reason
router.patch('/reject', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can reject returns', 'forbidden');

  const { reject_reason } = req.body;

  const { rows: rRows } = await db.query(
    `SELECT rr.*, u_buyer.name as buyer_name, u_buyer.email as buyer_email, p.name as product_name
     FROM return_requests rr
     JOIN orders o ON rr.order_id = o.id
     JOIN products p ON o.product_id = p.id
     JOIN users u_buyer ON rr.buyer_id = u_buyer.id
     WHERE rr.order_id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const rr = rRows[0];
  if (!rr) return err(res, 404, 'Return request not found or not yours', 'not_found');
  if (rr.status !== 'pending') return err(res, 400, `Return request is already ${rr.status}`, 'invalid_state');

  await db.query(
    'UPDATE return_requests SET status = $1, reject_reason = $2 WHERE order_id = $3',
    ['rejected', reject_reason?.trim() || null, req.params.id]
  );

  sendReturnEmail({
    type: 'rejected',
    order: { id: req.params.id, product_name: rr.product_name },
    buyer: { name: rr.buyer_name, email: rr.buyer_email },
    rejectReason: reject_reason?.trim() || null,
  }).catch(e => console.error('[Return] Email failed:', e.message));

  res.json({ success: true, message: 'Return request rejected' });
});

module.exports = router;
