const router = require('express').Router();
const db = require('../db/schema');
const adminAuth = require('../middleware/adminAuth');
const { sendPayment } = require('../utils/stellar');

// GET /api/admin/returns - list all return requests
router.get('/returns', adminAuth, (req, res) => {
  const returns = db.prepare(`
    SELECT r.*, o.total_price, o.shipping_cost, o.stellar_tx_hash AS order_tx_hash,
           p.name AS product_name,
           b.name AS buyer_name, b.email AS buyer_email
    FROM returns r
    JOIN orders o ON r.order_id = o.id
    JOIN products p ON o.product_id = p.id
    JOIN users b ON r.buyer_id = b.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(returns);
});

// POST /api/admin/returns/:id/approve
router.post('/returns/:id/approve', adminAuth, async (req, res) => {
  const ret = db.prepare(`
    SELECT r.*,
           o.total_price, o.shipping_cost,
           b.stellar_public_key AS buyer_wallet,
           f.stellar_secret_key AS farmer_secret
    FROM returns r
    JOIN orders o ON r.order_id = o.id
    JOIN users b ON r.buyer_id = b.id
    JOIN products p ON o.product_id = p.id
    JOIN users f ON p.farmer_id = f.id
    WHERE r.id = ?
  `).get(req.params.id);

  if (!ret) return res.status(404).json({ error: 'Return request not found' });
  if (ret.status !== 'pending') return res.status(400).json({ error: `Return already ${ret.status}` });

  const refundAmount = ret.total_price + (ret.shipping_cost || 0);

  try {
    const txHash = await sendPayment({
      senderSecret: ret.farmer_secret,
      receiverPublicKey: ret.buyer_wallet,
      amount: refundAmount,
      memo: `Refund#${ret.id}`,
    });

    db.prepare('UPDATE returns SET status = ?, refund_tx_hash = ? WHERE id = ?')
      .run('approved', txHash, ret.id);

    res.json({ message: 'Return approved and refund issued', refundAmount, txHash });
  } catch (err) {
    res.status(500).json({ error: 'Refund transaction failed: ' + err.message });
  }
});

// POST /api/admin/returns/:id/reject
router.post('/returns/:id/reject', adminAuth, (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Return request not found' });
  if (ret.status !== 'pending') return res.status(400).json({ error: `Return already ${ret.status}` });

  db.prepare('UPDATE returns SET status = ? WHERE id = ?').run('rejected', ret.id);
  res.json({ message: 'Return request rejected' });
});

// GET /api/admin/users - list users with pagination and filters
router.get('/users', adminAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.active !== undefined) {
    const activeValue = req.query.active === '1' || req.query.active === 'true';
    params.push(activeValue);
    conditions.push(`active = $${params.length}`);
  }
  if (req.query.role !== undefined) {
    params.push(req.query.role);
    conditions.push(`role = $${params.length}`);
  }
  if (req.query.verified !== undefined) {
    if (req.query.verified === 'true' || req.query.verified === '1') {
      conditions.push('email_verified_at IS NOT NULL');
    } else {
      conditions.push('email_verified_at IS NULL');
    }
  }
  if (req.query.banned !== undefined) {
    if (req.query.banned === 'true' || req.query.banned === '1') {
      conditions.push('banned_at IS NOT NULL');
    } else {
      conditions.push('banned_at IS NULL');
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(`SELECT COUNT(*) as count FROM users ${where}`, params);
  const total = parseInt(countResult.rows[0].count, 10);
  const pages = Math.ceil(total / limit);

  params.push(limit);
  params.push(offset);
  const users = await db.query(
    `SELECT id, name, email, role, created_at, active, banned_at, email_verified_at
     FROM users
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: users.rows,
    pagination: { page, limit, total, pages },
  });
});

// GET /api/admin/orders - list orders with pagination
router.get('/orders', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
  
  const offset = (page - 1) * limit;
  
  // Get total count
  const countResult = db.prepare('SELECT COUNT(*) as count FROM orders').get();
  const total = countResult.count;
  const pages = Math.ceil(total / limit);
  
  // Get paginated data
  const orders = db.prepare(`
    SELECT 
      o.id, 
      o.buyer_id, 
      b.name AS buyer_name,
      o.product_id,
      p.name AS product_name,
      o.quantity,
      o.total_price,
      o.status,
      o.created_at
    FROM orders o
    JOIN users b ON o.buyer_id = b.id
    JOIN products p ON o.product_id = p.id
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  
  res.json({
    data: orders,
    pagination: {
      page,
      limit,
      total,
      pages
    }
  });
});

// DELETE /api/admin/users/:id - deactivate user
router.delete('/users/:id', adminAuth, (req, res) => {
  const userId = req.params.id;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);
  
  res.json({ message: 'User deactivated successfully' });
});

// GET /api/admin/stats - dashboard statistics
router.get('/stats', adminAuth, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = ?').get('paid').total;
  
  res.json({
    totalUsers,
    totalProducts,
    totalOrders,
    totalRevenue
  });
});

// GET /api/admin/analytics/summary - last-30-day platform metrics
router.get('/analytics/summary', adminAuth, (req, res) => {
  const gmv = db.prepare(`
    SELECT
      ROUND(SUM(total_price), 7)                                             AS total,
      ROUND(SUM(total_price - COALESCE(shipping_cost, 0)), 7)                AS product,
      ROUND(SUM(COALESCE(shipping_cost, 0)), 7)                              AS shipping,
      COUNT(*)                                                                AS paid_orders
    FROM orders
    WHERE status = 'paid'
      AND created_at >= datetime('now', '-30 days')
  `).get();

  const conversion = db.prepare(`
    SELECT
      COUNT(*)                                                                              AS total_orders,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END)                                    AS paid_orders,
      ROUND(100.0 * SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) / COUNT(*), 2)       AS rate_pct
    FROM orders
    WHERE created_at >= datetime('now', '-30 days')
  `).get();

  const topProducts = db.prepare(`
    SELECT p.id, p.name, u.name AS farmer_name,
           SUM(o.quantity)                                                   AS units_sold,
           ROUND(SUM(o.total_price - COALESCE(o.shipping_cost, 0)), 7)      AS revenue
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN users u ON p.farmer_id = u.id
    WHERE o.status = 'paid'
      AND o.created_at >= datetime('now', '-30 days')
    GROUP BY p.id
    ORDER BY revenue DESC
    LIMIT 5
  `).all();

  // Daily active users: distinct buyers + farmers touched by orders each day
  const dailyActiveUsers = db.prepare(`
    SELECT day, COUNT(DISTINCT user_id) AS active_users
    FROM (
      SELECT date(o.created_at) AS day, o.buyer_id AS user_id
      FROM orders o
      WHERE o.created_at >= datetime('now', '-30 days')
      UNION ALL
      SELECT date(o.created_at) AS day, p.farmer_id AS user_id
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.created_at >= datetime('now', '-30 days')
    )
    GROUP BY day
    ORDER BY day ASC
  `).all();

  const dailyGmv = db.prepare(`
    SELECT date(created_at) AS day, ROUND(SUM(total_price), 7) AS gmv, COUNT(*) AS orders
    FROM orders
    WHERE status = 'paid'
      AND created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  res.json({
    period: 'last_30_days',
    gmv,
    conversion: conversion.total_orders ? conversion : { total_orders: 0, paid_orders: 0, rate_pct: 0 },
    top_products: topProducts,
    daily_active_users: dailyActiveUsers,
    daily_gmv: dailyGmv,
  });
});

// GET /api/admin/failed-emails
router.get('/failed-emails', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM failed_emails ORDER BY created_at DESC').all();
  res.json({ success: true, data: rows });
});

module.exports = router;
