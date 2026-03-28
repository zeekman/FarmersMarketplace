const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// GET /api/analytics/farmer
router.get('/farmer', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const farmerId = req.user.id;

  const { rows: totalsRows } = await db.query(
    `SELECT COUNT(*) as order_count, COALESCE(SUM(o.total_price), 0) as total_revenue
     FROM orders o JOIN products p ON o.product_id = p.id
     WHERE p.farmer_id = $1 AND o.status = 'paid'`,
    [farmerId]
  );

  const { rows: topProducts } = await db.query(
    `SELECT p.name, COALESCE(SUM(o.total_price), 0) as revenue, COUNT(*) as orders
     FROM orders o JOIN products p ON o.product_id = p.id
     WHERE p.farmer_id = $1 AND o.status = 'paid'
     GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 5`,
    [farmerId]
  );

  const { rows: monthly } = await db.query(
    `SELECT TO_CHAR(o.created_at, 'YYYY-MM') as month,
            COALESCE(SUM(o.total_price), 0) as revenue, COUNT(*) as orders
     FROM orders o JOIN products p ON o.product_id = p.id
     WHERE p.farmer_id = $1 AND o.status = 'paid'
       AND o.created_at >= NOW() - INTERVAL '6 months'
     GROUP BY month ORDER BY month ASC`,
    [farmerId]
  );

  res.json({
    success: true,
    data: {
      total_revenue: totalsRows[0].total_revenue,
      order_count: totalsRows[0].order_count,
      top_products: topProducts,
      monthly,
    },
  });
});

module.exports = router;
