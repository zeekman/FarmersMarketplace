const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// GET /api/analytics/farmer - farmer's own sales analytics
router.get('/farmer', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Farmers only', 'forbidden');

  const farmerId = req.user.id;

  const totals = db.prepare(`
    SELECT COUNT(*) as order_count, COALESCE(SUM(o.total_price), 0) as total_revenue
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE p.farmer_id = ? AND o.status = 'paid'
  `).get(farmerId);

  const topProducts = db.prepare(`
    SELECT p.name, COALESCE(SUM(o.total_price), 0) as revenue, COUNT(*) as orders
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE p.farmer_id = ? AND o.status = 'paid'
    GROUP BY p.id, p.name
    ORDER BY revenue DESC
    LIMIT 5
  `).all(farmerId);

  // Monthly revenue for last 6 months
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', o.created_at) as month,
           COALESCE(SUM(o.total_price), 0) as revenue,
           COUNT(*) as orders
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE p.farmer_id = ? AND o.status = 'paid'
      AND o.created_at >= date('now', '-6 months')
    GROUP BY month
    ORDER BY month ASC
  `).all(farmerId);

  res.json({
    success: true,
    data: {
      total_revenue: totals.total_revenue,
      order_count: totals.order_count,
      top_products: topProducts,
      monthly,
    },
  });
});

module.exports = router;
