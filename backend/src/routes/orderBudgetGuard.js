/**
 * orderBudgetGuard.js
 *
 * Middleware that enforces a buyer's monthly XLM budget before an order is created.
 * Must be mounted at /api/orders BEFORE the orders router so the check runs
 * before any Stellar payment is initiated.
 *
 * WHY PENDING ORDERS ARE INCLUDED:
 *   Including only 'paid' orders allows a race condition where multiple concurrent
 *   requests each read the same (lower) spend total and all pass the budget check,
 *   resulting in overspending. By including 'pending' orders we count in-flight
 *   orders that have not yet been paid/failed.
 *
 * MONTHLY WINDOW:
 *   PostgreSQL: date_trunc('month', NOW()) to NOW() — resets consistently at
 *   midnight UTC on the 1st of each month without any application-level date math.
 *   SQLite (local dev / test): JS-computed UTC month boundaries passed as query
 *   params — semantically equivalent to date_trunc('month', NOW()).
 *
 * CONCURRENCY — Advisory lock (PostgreSQL) / serialised check (SQLite):
 *   On PostgreSQL we acquire a session-level advisory lock keyed on the buyer's
 *   user id before reading the spend total.  This serialises concurrent budget
 *   checks for the same buyer so only one request can pass the gate at a time.
 *
 *   On SQLite (local dev / test) we use a per-user JS promise-chain mutex so
 *   concurrent async checks for the same buyer are serialised in the event loop.
 *
 * RESPONSE ON VIOLATION:
 *   HTTP 402 with { code: 'budget_exceeded', limit_xlm, spent_xlm }
 */

const db = require('../db/schema');
const auth = require('../middleware/auth');
const router = require('express').Router();

/**
 * Per-user mutex for the non-Postgres path.
 * Maps userId → Promise (the tail of the current serialised chain).
 */
const userLocks = new Map();

function getMonthRangeUtc() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0),
  );
  return { start: start.toISOString(), end: end.toISOString() };
}

router.post('/', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'buyer') return next();

    const overrideConfirmed = req.body?.budget_override_confirmed === true;

    // Best-effort price estimate from the request body; the authoritative total
    // is computed inside the orders route after all discounts are applied.
    const newOrderPrice = Number(req.body?.total_price ?? req.body?.price ?? 0);

    const isPostgres = db.isPostgres;

    if (isPostgres) {
      // --- PostgreSQL path: advisory lock + dedicated client ---
      const client = await db.getClient();
      res.locals.budgetClient = client;

      try {
        await client.query('BEGIN');

        // Advisory lock serialises concurrent budget checks for this buyer.
        await client.query('SELECT pg_advisory_xact_lock($1)', [req.user.id]);

        const { rows: userRows } = await client.query(
          'SELECT monthly_budget FROM users WHERE id = $1',
          [req.user.id],
        );
        const monthlyBudget = userRows[0]?.monthly_budget;

        if (monthlyBudget == null) {
          await client.query('ROLLBACK');
          client.release();
          delete res.locals.budgetClient;
          return next();
        }

        // date_trunc resets the window at midnight UTC on the 1st of each month.
        const { rows: spendRows } = await client.query(
          `SELECT COALESCE(SUM(total_price), 0) AS spent
           FROM orders
           WHERE buyer_id = $1
             AND status IN ('pending', 'paid')
             AND created_at >= date_trunc('month', NOW())
             AND created_at <= NOW()`,
          [req.user.id],
        );

        const spent = Number(spendRows[0]?.spent || 0);
        const budget = Number(monthlyBudget);

        if (spent + newOrderPrice > budget && !overrideConfirmed) {
          await client.query('ROLLBACK');
          client.release();
          delete res.locals.budgetClient;
          return res.status(402).json({
            success: false,
            error: 'Monthly budget exceeded. Set budget_override_confirmed=true to continue.',
            code: 'budget_exceeded',
            limit_xlm: budget,
            spent_xlm: spent,
          });
        }

        await client.query('COMMIT');
        client.release();
        delete res.locals.budgetClient;
        return next();
      } catch (lockErr) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        client.release();
        delete res.locals.budgetClient;
        throw lockErr;
      }
    } else {
      // --- Non-Postgres path: JS mutex serialises concurrent checks per buyer ---
      const userId = req.user.id;

      const prev = userLocks.get(userId) || Promise.resolve();
      let releaseLock;
      const lockPromise = new Promise((resolve) => { releaseLock = resolve; });
      userLocks.set(userId, prev.then(() => lockPromise));

      await prev;

      try {
        const { rows: userRows } = await db.query(
          'SELECT monthly_budget FROM users WHERE id = $1',
          [req.user.id],
        );
        const monthlyBudget = userRows[0]?.monthly_budget;

        if (monthlyBudget == null) {
          releaseLock();
          return next();
        }

        // SQLite equivalent of date_trunc('month', NOW()): JS-computed UTC month
        // boundaries passed as query params.
        const { start, end } = getMonthRangeUtc();

        const { rows: spendRows } = await db.query(
          `SELECT COALESCE(SUM(total_price), 0) AS spent
           FROM orders
           WHERE buyer_id = $1
             AND status IN ('pending', 'paid')
             AND created_at >= $2
             AND created_at < $3`,
          [req.user.id, start, end],
        );

        const spent = Number(spendRows[0]?.spent || 0);
        const budget = Number(monthlyBudget);

        if (spent + newOrderPrice > budget && !overrideConfirmed) {
          releaseLock();
          return res.status(402).json({
            success: false,
            error: 'Monthly budget exceeded. Set budget_override_confirmed=true to continue.',
            code: 'budget_exceeded',
            limit_xlm: budget,
            spent_xlm: spent,
          });
        }

        await new Promise((resolve) => {
          next();
          setImmediate(resolve);
        });
        releaseLock();
        return;
      } catch (e) {
        releaseLock();
        throw e;
      }
    }
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message || 'Budget validation failed',
    });
  }
});

module.exports = router;
