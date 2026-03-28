/**
 * Calendar routes mounted under /api/products/:id/calendar
 * GET  — public, returns next 12 weeks (defaults to available if not set)
 * POST — farmer only, sets weekly availability
 */
const router = require('express').Router({ mergeParams: true });
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// Helper: generate next 12 Monday-based week_start dates from today
function next12Weeks() {
  const weeks = [];
  const now = new Date();
  // Align to the current Monday
  const day = now.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 12; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

// GET /api/products/:id/calendar
router.get('/', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const weeks = next12Weeks();

  const { rows } = await db.query(
    `SELECT week_start, available FROM availability_calendar
     WHERE product_id = $1 AND week_start >= $2
     ORDER BY week_start`,
    [productId, weeks[0]]
  );

  const map = {};
  for (const r of rows) map[r.week_start] = !!r.available;

  const calendar = weeks.map((w) => ({
    week_start: w,
    available: map[w] !== undefined ? map[w] : true, // default available
  }));

  res.json({ success: true, data: calendar });
});

// POST /api/products/:id/calendar — farmer sets availability for a week
// Body: { week_start: "YYYY-MM-DD", available: true|false }
router.post('/', auth, async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const { week_start, available } = req.body;

  if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return err(res, 400, 'week_start must be a YYYY-MM-DD date', 'validation_error');
  }
  if (available === undefined) {
    return err(res, 400, 'available is required', 'validation_error');
  }

  // Verify ownership
  const { rows: pRows } = await db.query(
    'SELECT farmer_id FROM products WHERE id = $1',
    [productId]
  );
  if (!pRows.length) return err(res, 404, 'Product not found', 'not_found');
  if (pRows[0].farmer_id !== req.user.id) return err(res, 403, 'Forbidden', 'forbidden');

  // Upsert
  if (db.isPostgres) {
    await db.query(
      `INSERT INTO availability_calendar (product_id, week_start, available)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, week_start) DO UPDATE SET available = EXCLUDED.available`,
      [productId, week_start, available ? 1 : 0]
    );
  } else {
    await db.query(
      `INSERT OR REPLACE INTO availability_calendar (product_id, week_start, available)
       VALUES ($1, $2, $3)`,
      [productId, week_start, available ? 1 : 0]
    );
  }

  res.json({ success: true });
});

module.exports = router;
