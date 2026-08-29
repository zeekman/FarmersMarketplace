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

function getResetAt() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

async function getBudgetSummary(userId) {
  const { start, end } = getMonthRangeUtc();

  const { rows: userRows } = await db.query('SELECT monthly_budget FROM users WHERE id = $1', [
    userId,
  ]);
  const limit_xlm =
    userRows[0]?.monthly_budget != null ? Number(userRows[0].monthly_budget) : null;

  // Include both pending and paid to match the enforcement logic in orderBudgetGuard.
  const { rows: spendRows } = await db.query(
    `SELECT COALESCE(SUM(total_price), 0) AS spent
     FROM orders
     WHERE buyer_id = $1 AND status IN ('pending', 'paid') AND created_at >= $2 AND created_at < $3`,
    [userId, start, end]
  );

  const spent_xlm = Number(spendRows[0]?.spent || 0);
  const remaining_xlm =
    limit_xlm == null ? null : Number((limit_xlm - spent_xlm).toFixed(7));
  const reset_at = getResetAt();

  return { limit_xlm, spent_xlm, remaining_xlm, reset_at };
}

// GET /api/wallet/budget — full budget summary (backward compatible)
router.get('/budget', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can access budgets', 'forbidden');
  try {
    const summary = await getBudgetSummary(req.user.id);
    res.json({ success: true, ...summary });
  } catch (e) {
    err(res, 500, e.message, 'server_error');
  }
});

// GET /api/wallet/budget-status — budget status with reset_at
router.get('/budget-status', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can access budgets', 'forbidden');
  try {
    const summary = await getBudgetSummary(req.user.id);
    res.json({ success: true, ...summary });
  } catch (e) {
    err(res, 500, e.message, 'server_error');
  }
});

// PUT /api/wallet/budget — set, update, or remove monthly spending limit
// { limit_xlm: N } to set/update; { limit_xlm: null } or { limit_xlm: 0 } to remove
router.put('/budget', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can set budgets', 'forbidden');

  const { limit_xlm } = req.body;

  if (limit_xlm !== null && limit_xlm !== undefined) {
    if (typeof limit_xlm !== 'number' || limit_xlm < 0) {
      return err(res, 400, 'limit_xlm must be a non-negative number or null', 'validation_error');
    }
  }

  // 0 or null removes the limit (stored as NULL)
  const budget = limit_xlm === null || limit_xlm === 0 ? null : limit_xlm;
  await db.query('UPDATE users SET monthly_budget = $1 WHERE id = $2', [budget, req.user.id]);

  try {
    const summary = await getBudgetSummary(req.user.id);
    res.json({ success: true, ...summary });
  } catch (e) {
    err(res, 500, e.message, 'server_error');
  }
});

// PATCH /api/wallet/budget — preserved for backward compatibility
router.patch('/budget', auth, validate.updateBudget, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can set budgets', 'forbidden');

  const { monthly_limit } = req.body;
  const budget = monthly_limit === 0 ? null : monthly_limit;
  await db.query('UPDATE users SET monthly_budget = $1 WHERE id = $2', [budget, req.user.id]);

  try {
    const summary = await getBudgetSummary(req.user.id);
    res.json({ success: true, budgetGuardEnabled: budget !== null, ...summary });
  } catch (e) {
    err(res, 500, e.message, 'server_error');
  }
});

module.exports = router;
