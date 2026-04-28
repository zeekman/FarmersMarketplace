const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

function getMonthRangeUtc() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function getBudgetSummary(userId) {
  const { start, end } = getMonthRangeUtc();

  const { rows: userRows } = await db.query('SELECT monthly_budget FROM users WHERE id = $1', [
    userId,
  ]);
  const monthlyBudget =
    userRows[0]?.monthly_budget != null ? Number(userRows[0].monthly_budget) : null;

  // Include both pending and paid orders so the displayed spend matches the
  // budget guard logic and users can see in-flight orders counted against their budget.
  const { rows: spendRows } = await db.query(
    `SELECT COALESCE(SUM(total_price), 0) AS spent
     FROM orders
     WHERE buyer_id = $1 AND status IN ('pending', 'paid') AND created_at >= $2 AND created_at < $3`,
    [userId, start, end]
  );

  const spentThisMonth = Number(spendRows[0]?.spent || 0);
  const remaining =
    monthlyBudget == null ? null : Number((monthlyBudget - spentThisMonth).toFixed(7));
  const percentUsed =
    monthlyBudget && monthlyBudget > 0
      ? Number(((spentThisMonth / monthlyBudget) * 100).toFixed(2))
      : 0;

  return {
    budget: monthlyBudget,
    spentThisMonth,
    remaining,
    percentUsed,
    warning: monthlyBudget != null && percentUsed >= 80,
    exceeded: monthlyBudget != null && spentThisMonth > monthlyBudget,
  };
}

router.get('/budget', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can access budgets', 'forbidden');

  const summary = await getBudgetSummary(req.user.id);
  res.json({ success: true, ...summary });
});

router.patch('/budget', auth, validate.updateBudget, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can set budgets', 'forbidden');

  const { monthly_limit } = req.body;
  // 0 explicitly disables the budget guard (stored as null); >0 enforces it
  const budget = monthly_limit === 0 ? null : monthly_limit;
  await db.query('UPDATE users SET monthly_budget = $1 WHERE id = $2', [budget, req.user.id]);

  const summary = await getBudgetSummary(req.user.id);
  res.json({ success: true, budgetGuardEnabled: budget !== null, ...summary });
});

module.exports = router;
