const router = require('express').Router();
const db = require('../db/schema');
const { invalidateAuthStatus } = require('../cache');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { sendPayment } = require('../utils/stellar');
const { decryptUserSecretKey } = require('../utils/crypto');
const { writeAuditLog } = require('../utils/auditLog');
const { parsePagination, sendPaginated } = require('../utils/pagination');

router.use(auth, requireAdmin);

// GET /api/admin/returns - list all return requests
router.get('/returns', async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const { rows: countRows } = await db.query('SELECT COUNT(*) AS count FROM returns');
  const total = Number(countRows[0]?.count || 0);
  const { rows } = await db.query(`
    SELECT r.*, o.total_price, o.shipping_cost, o.stellar_tx_hash AS order_tx_hash,
           p.name AS product_name, b.name AS buyer_name, b.email AS buyer_email
    FROM returns r
    JOIN orders o ON r.order_id = o.id
    JOIN products p ON o.product_id = p.id
    JOIN users b ON r.buyer_id = b.id
    ORDER BY r.created_at DESC, r.id DESC LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return sendPaginated(res, req, rows, { page, limit, total });
});

router.post('/returns/:id/approve', async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*,
            o.total_price, o.shipping_cost,
            b.stellar_public_key AS buyer_wallet,
            f.stellar_secret_key AS farmer_secret
     FROM returns r
     JOIN orders o ON r.order_id = o.id
     JOIN users b ON r.buyer_id = b.id
     JOIN products p ON o.product_id = p.id
     JOIN users f ON p.farmer_id = f.id
     WHERE r.id = $1`,
    [req.params.id]
  );
  const ret = rows[0];
  if (!ret) return res.status(404).json({ error: 'Return request not found' });
  if (ret.status !== 'pending') return res.status(400).json({ error: `Return already ${ret.status}` });

  const refundAmount = Number(ret.total_price) + Number(ret.shipping_cost || 0);

  try {
    const txHash = await sendPayment({
      senderSecret: await decryptUserSecretKey(ret.farmer_secret),
      receiverPublicKey: ret.buyer_wallet,
      amount: refundAmount,
      memo: `Refund#${ret.id}`,
    });

    await db.query('UPDATE returns SET status = $1, refund_tx_hash = $2 WHERE id = $3', [
      'approved',
      txHash,
      ret.id,
    ]);

    // BE-40: Audit log
    await writeAuditLog({
      adminId: req.user.id,
      action: 'approve_return',
      targetType: 'return',
      targetId: ret.id,
      before: { status: 'pending' },
      after: { status: 'approved', refund_tx_hash: txHash },
      req,
    });

    res.json({ message: 'Return approved and refund issued', refundAmount, txHash });
  } catch (error) {
    res.status(500).json({ error: 'Refund transaction failed: ' + error.message });
  }
});

// POST /api/admin/returns/:id/reject
router.post('/returns/:id/reject', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM returns WHERE id = $1', [req.params.id]);
  const ret = rows[0];
  if (!ret) return res.status(404).json({ error: 'Return request not found' });
  if (ret.status !== 'pending') return res.status(400).json({ error: `Return already ${ret.status}` });
  await db.query('UPDATE returns SET status = $1 WHERE id = $2', ['rejected', ret.id]);
  await writeAuditLog({ adminId: req.user.id, action: 'reject_return', targetType: 'return', targetId: ret.id,
    before: { status: 'pending' }, after: { status: 'rejected' }, req });
  res.json({ message: 'Return request rejected' });
});

router.get('/users', async (req, res) => {
  const { page, limit, offset } = parsePagination(req, { maxLimit: 200, defaultLimit: 50 });
  const conditions = [];
  const params = [];
  if (req.query.active !== undefined) { params.push(req.query.active === '1' || req.query.active === 'true'); conditions.push(`active = $${params.length}`); }
  if (req.query.role !== undefined) { params.push(req.query.role); conditions.push(`role = $${params.length}`); }
  if (req.query.verified !== undefined) conditions.push(req.query.verified === 'true' || req.query.verified === '1' ? 'email_verified_at IS NOT NULL' : 'email_verified_at IS NULL');
  if (req.query.banned !== undefined) conditions.push(req.query.banned === 'true' || req.query.banned === '1' ? 'banned_at IS NOT NULL' : 'banned_at IS NULL');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await db.query(`SELECT COUNT(*) as count FROM users ${where}`, params);
  const total = Number(countResult.rows[0].count);
  const usersParams = [...params, limit, offset];
  const { rows } = await db.query(`SELECT id, name, email, role, created_at, active, banned_at, email_verified_at FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT $${usersParams.length - 1} OFFSET $${usersParams.length}`, usersParams);
  return sendPaginated(res, req, rows, { page, limit, total });
});

// GET /api/admin/orders - list orders with pagination
router.get('/orders', async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM orders');
  const total = Number(countRows[0].count);
  const { rows } = await db.query(`SELECT o.id, o.buyer_id, b.name AS buyer_name, o.product_id, p.name AS product_name, o.quantity, o.total_price, o.status, o.created_at
    FROM orders o JOIN users b ON o.buyer_id = b.id JOIN products p ON o.product_id = p.id
    ORDER BY o.created_at DESC, o.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  return sendPaginated(res, req, rows, { page, limit, total });
});

// GET /api/admin/stats - dashboard statistics
router.get('/stats', async (req, res) => {
  const count = async (sql, params) => Number((await db.query(sql, params)).rows[0].count);
  const totalUsers = await count('SELECT COUNT(*) as count FROM users');
  const totalProducts = await count('SELECT COUNT(*) as count FROM products');
  const totalOrders = await count('SELECT COUNT(*) as count FROM orders');
  const totalRevenue = (
    await db.query("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = $1", ['paid'])
  ).rows[0].total;
  
  res.json({
    totalUsers,
    totalProducts,
    totalOrders,
    totalRevenue
  });
});

router.get('/stats', async (_req, res) => {
  const count = async (sql) => Number((await db.query(sql)).rows[0].count);
  const [totalUsers, totalProducts, totalOrders] = await Promise.all([
    count('SELECT COUNT(*) as count FROM users'),
    count('SELECT COUNT(*) as count FROM products'),
    count('SELECT COUNT(*) as count FROM orders'),
  ]);
  const { rows } = await db.query(
    "SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = $1",
    ['paid']
  );

  res.json({ totalUsers, totalProducts, totalOrders, totalRevenue: Number(rows[0].total) });
});

router.get('/analytics/summary', async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  const { rows: gmvRows } = await db.query(
    `SELECT ROUND(SUM(total_price), 7) AS total,
            ROUND(SUM(total_price - COALESCE(shipping_cost, 0)), 7) AS product,
            ROUND(SUM(COALESCE(shipping_cost, 0)), 7) AS shipping,
            COUNT(*) AS paid_orders
     FROM orders
     WHERE status = 'paid' AND created_at >= $1`,
    [since]
  );
  const { rows: conversionRows } = await db.query(
    `SELECT COUNT(*) AS total_orders,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
            ROUND(100.0 * SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) / COUNT(*), 2) AS rate_pct
     FROM orders
     WHERE created_at >= $1`,
    [since]
  );
  const { rows: topProducts } = await db.query(
    `SELECT p.id, p.name, u.name AS farmer_name,
            SUM(o.quantity) AS units_sold,
            ROUND(SUM(o.total_price - COALESCE(o.shipping_cost, 0)), 7) AS revenue
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON p.farmer_id = u.id
     WHERE o.status = 'paid' AND o.created_at >= $1
     GROUP BY p.id, p.name, u.name
     ORDER BY revenue DESC
     LIMIT 5`,
    [since]
  );
  const dayExpression = db.isPostgres ? 'CAST(created_at AS DATE)' : 'date(created_at)';
  const { rows: dailyActiveUsers } = await db.query(
    `SELECT day, COUNT(DISTINCT user_id) AS active_users
     FROM (
       SELECT ${db.isPostgres ? 'CAST(o.created_at AS DATE)' : 'date(o.created_at)'} AS day, o.buyer_id AS user_id
       FROM orders o
       WHERE o.created_at >= $1
       UNION ALL
       SELECT ${db.isPostgres ? 'CAST(o.created_at AS DATE)' : 'date(o.created_at)'} AS day, p.farmer_id AS user_id
       FROM orders o
       JOIN products p ON o.product_id = p.id
       WHERE o.created_at >= $2
     ) t
     GROUP BY day
     ORDER BY day ASC`,
    [since, since]
  );
  const { rows: dailyGmv } = await db.query(
    `SELECT ${dayExpression} AS day, ROUND(SUM(total_price), 7) AS gmv, COUNT(*) AS orders
     FROM orders
     WHERE status = 'paid' AND created_at >= $1
     GROUP BY ${dayExpression}
     ORDER BY day ASC`,
    [since]
  );
  const conversion = conversionRows[0];
  res.json({
    period: 'last_30_days',
    gmv: gmvRows[0],
    conversion: Number(conversion.total_orders)
      ? conversion
      : { total_orders: 0, paid_orders: 0, rate_pct: 0 },
    top_products: topProducts,
    daily_active_users: dailyActiveUsers,
    daily_gmv: dailyGmv,
  });
});

// GET /api/admin/failed-emails
router.get('/failed-emails', async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const { rows: countRows } = await db.query('SELECT COUNT(*) AS count FROM failed_emails');
  const total = Number(countRows[0]?.count || 0);
  const { rows } = await db.query('SELECT * FROM failed_emails ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2', [limit, offset]);
  return sendPaginated(res, req, rows, { page, limit, total });
});

router.get('/analytics/creator-earnings', async (_req, res) => {
  const { rows: totalsRows } = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'credit' THEN amount ELSE 0 END), 0) AS total_credited,
       COALESCE(SUM(CASE WHEN event_type = 'claim' THEN amount ELSE 0 END), 0) AS total_claimed,
       COALESCE(SUM(CASE WHEN event_type = 'credit' THEN fee_amount ELSE 0 END), 0) AS total_platform_fee
     FROM creator_earnings_ledger`
  );

  const dayExpression = db.isPostgres ? `TO_CHAR(created_at, 'YYYY-MM-DD')` : 'date(created_at)';
  const { rows: seriesRows } = await db.query(
    `SELECT ${dayExpression} AS day, event_type,
            COALESCE(SUM(amount), 0) AS amount,
            COALESCE(SUM(fee_amount), 0) AS fee_amount
     FROM creator_earnings_ledger
     GROUP BY ${dayExpression}, event_type
     ORDER BY day ASC`
  );

  const byDay = new Map();
  for (const row of seriesRows) {
    if (!byDay.has(row.day)) {
      byDay.set(row.day, { day: row.day, credited: 0, claimed: 0, platform_fee: 0 });
    }
    const bucket = byDay.get(row.day);
    if (row.event_type === 'credit') {
      bucket.credited += Number(row.amount);
      bucket.platform_fee += Number(row.fee_amount);
    } else if (row.event_type === 'claim') {
      bucket.claimed += Number(row.amount);
    }
  }

  res.json({
    success: true,
    data: {
      total_credited_xlm: Number(totalsRows[0].total_credited),
      total_claimed_xlm: Number(totalsRows[0].total_claimed),
      total_platform_fee_xlm: Number(totalsRows[0].total_platform_fee),
      time_series: [...byDay.values()],
    },
  });
});

// BE-38: GET /api/admin/message-reports — view reported messages
router.get('/message-reports', async (req, res) => {
  const { page, limit, offset } = parsePagination(req);

  const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM message_reports');
  const total = Number(countRows[0].count);

  const { rows } = await db.query(
    `SELECT 
      r.id, r.message_id, r.reason, r.created_at,
      m.content as message_content, m.created_at as message_created_at,
      sender.id as sender_id, sender.name as sender_name, sender.email as sender_email,
      reporter.id as reporter_id, reporter.name as reporter_name, reporter.email as reporter_email
     FROM message_reports r
     JOIN messages m ON r.message_id = m.id
     JOIN users sender ON m.sender_id = sender.id
     JOIN users reporter ON r.reporter_id = reporter.id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return sendPaginated(res, req, rows, { page, limit, total });
});

module.exports = router;
