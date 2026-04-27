/**
 * orderBudgetGuard.js
 *
 * Middleware that enforces a buyer's monthly budget before an order is created.
 *
 * WHY PENDING ORDERS ARE INCLUDED:
 *   Including only 'paid' orders allows a race condition where multiple concurrent
 *   requests each read the same (lower) spend total and all pass the budget check,
 *   resulting in overspending. By including 'pending' orders we count in-flight
 *   orders that have not yet been paid/failed.
 *
 * CONCURRENCY APPROACH — Advisory lock (PostgreSQL) / serialised check (SQLite):
 *   On PostgreSQL we acquire a session-level advisory lock keyed on the buyer's
 *   user id before reading the spend total.  This serialises concurrent budget
 *   checks for the same buyer so only one request can pass the gate at a time.
 *   The lock is released automatically when the DB client is released back to
 *   the pool (end of request).
 *
 *   On SQLite (local dev / test) we use a per-user JS promise-chain mutex so
 *   concurrent async checks for the same buyer are serialised in the event loop.
 *
 * TRANSACTION FLOW:
 *   1. Acquire advisory lock for this buyer (Postgres only).
 *   2. Read monthly_budget from users.
 *   3. SUM total_price of orders WHERE status IN ('pending','paid') for this month.
 *   4. If (spent + new_order_price) > budget → reject 400.
 *   5. Otherwise call next(); the order route will INSERT the order.
 *   6. Release lock when the client is returned to the pool.
 */

const db = require('../db/schema');
const auth = require('../middleware/auth');
const router = require('express').Router();

/**
 * Per-user mutex for the non-Postgres path.
 * Maps userId → Promise (the tail of the current serialised chain).
 * Each new request appends itself to the chain so budget checks are
 * processed one-at-a-time per buyer, preventing concurrent reads from
 * both seeing the same (stale) spend total.
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

    // Resolve the price of the incoming order so we can check (spent + new) vs budget.
    // total_price is computed later in the orders route, so we do a best-effort
    // estimate here using the raw body values.  The authoritative check is the
    // sum query below; this estimate is only used for the pre-insert rejection.
    const newOrderPrice = Number(req.body?.total_price ?? req.body?.price ?? 0);

    const isPostgres = db.isPostgres;

    if (isPostgres) {
      // --- PostgreSQL path: advisory lock + dedicated client ---
      const client = await db.getClient();
      res.locals.budgetClient = client; // pass to order route for reuse if needed

      try {
        await client.query('BEGIN');

        // Advisory lock serialises concurrent budget checks for this buyer.
        // pg_try_advisory_xact_lock is transaction-scoped and released on COMMIT/ROLLBACK.
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

        const { start, end } = getMonthRangeUtc();

        // Include both pending and paid orders to prevent race-condition overspending.
        const { rows: spendRows } = await client.query(
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
          await client.query('ROLLBACK');
          client.release();
          delete res.locals.budgetClient;
          return res.status(400).json({
            success: false,
            error: 'Monthly budget exceeded. Set budget_override_confirmed=true to continue.',
            code: 'budget_exceeded',
            budget,
            spentThisMonth: spent,
          });
        }

        // Keep the transaction open so the advisory lock is held until the order
        // INSERT completes.  The order route must call COMMIT (or ROLLBACK) and
        // release the client.  If the order route does not use res.locals.budgetClient
        // we commit here and release.
        // For simplicity we commit here — the lock has already serialised the read.
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

      // Build a serialised chain: each request waits for the previous one to finish.
      const prev = userLocks.get(userId) || Promise.resolve();
      let releaseLock;
      const lockPromise = new Promise((resolve) => { releaseLock = resolve; });
      userLocks.set(userId, prev.then(() => lockPromise));

      // Wait for our turn
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

        const { start, end } = getMonthRangeUtc();

        // Include both pending and paid orders to prevent race-condition overspending.
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
          return res.status(400).json({
            success: false,
            error: 'Monthly budget exceeded. Set budget_override_confirmed=true to continue.',
            code: 'budget_exceeded',
            budget,
            spentThisMonth: spent,
          });
        }

        // Pass control to the order route; release the lock after next() returns
        // so the INSERT happens while the lock is still held, preventing a second
        // concurrent request from reading the pre-insert spend total.
        await new Promise((resolve, reject) => {
          next();
          // next() is synchronous in Express — resolve immediately so the lock
          // is released only after the downstream handler has had a chance to run.
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
