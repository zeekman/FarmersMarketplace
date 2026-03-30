const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');

function getMonthRangeUtc() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

router.post('/', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'buyer') return next();

    const overrideConfirmed = req.body?.budget_override_confirmed === true;
    const { rows: userRows } = await db.query('SELECT monthly_budget FROM users WHERE id = $1', [
      req.user.id,
    ]);
    const monthlyBudget = userRows[0]?.monthly_budget;

    if (monthlyBudget == null) return next();

    const { start, end } = getMonthRangeUtc();
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(total_price), 0) AS spent
       FROM orders
       WHERE buyer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [req.user.id, start, end]
    );

    const spent = Number(rows[0]?.spent || 0);
    if (spent > Number(monthlyBudget) && !overrideConfirmed) {
      return res.status(400).json({
        success: false,
        error: 'Monthly budget exceeded. Set budget_override_confirmed=true to continue.',
        code: 'budget_exceeded',
        budget: Number(monthlyBudget),
        spentThisMonth: spent,
      });
    }

    return next();
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Budget validation failed' });
  }
});

module.exports = router;
