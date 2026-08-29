/**
 * Calendar routes at /api/calendar
 * POST /api/calendar        — farmer creates an availability entry (supports recurrence)
 * GET  /api/calendar        — returns expanded availability for a month (?product_id=&month=YYYY-MM)
 * DELETE /api/calendar/:id  — deletes an entry (series or instance based on delete_mode)
 */
const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// Expand a single calendar entry into date ranges within a given month
function expandEntry(entry, year, month) {
  const ranges = [];
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0)); // last day of month

  const from = new Date(entry.available_from + 'T00:00:00Z');
  const until = entry.available_until ? new Date(entry.available_until + 'T00:00:00Z') : null;
  const recEnd = entry.recurrence_end ? new Date(entry.recurrence_end + 'T00:00:00Z') : null;

  if (entry.recurrence === 'none') {
    // Simple fixed range — clip to month
    const s = from > monthStart ? from : monthStart;
    const e = until ? (until < monthEnd ? until : monthEnd) : monthEnd;
    if (s <= e) ranges.push({ from: s.toISOString().slice(0, 10), until: e.toISOString().slice(0, 10) });
    return ranges;
  }

  // Recurring: iterate occurrence start dates
  const intervalDays = entry.recurrence === 'weekly' ? 7 : entry.recurrence === 'biweekly' ? 14 : null;
  let cur = new Date(from);

  for (let i = 0; i < 500; i++) {
    if (cur > monthEnd) break;
    if (recEnd && cur > recEnd) break;

    // For monthly recurrence, advance by 1 month
    if (i > 0 && entry.recurrence === 'monthly') {
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate()));
    } else if (i > 0 && intervalDays) {
      cur = new Date(cur.getTime() + intervalDays * 86400000);
    }

    // Duration = original until - from (default 1 day if no until)
    const durationMs = until ? until.getTime() - from.getTime() : 0;
    const occEnd = new Date(cur.getTime() + durationMs);

    const actualEnd = recEnd && occEnd > recEnd ? recEnd : occEnd;
    if (recEnd && cur > recEnd) break;

    // Skip deleted instance
    if (entry.delete_instance_date) {
      const delDate = entry.delete_instance_date.slice(0, 10);
      if (cur.toISOString().slice(0, 10) === delDate) {
        if (entry.recurrence === 'monthly') {
          cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate()));
        } else if (intervalDays) {
          cur = new Date(cur.getTime() + intervalDays * 86400000);
        }
        i++;
        continue;
      }
    }

    // Clip to month
    if (actualEnd >= monthStart && cur <= monthEnd) {
      const s = cur < monthStart ? monthStart : cur;
      const e = actualEnd > monthEnd ? monthEnd : actualEnd;
      ranges.push({ from: s.toISOString().slice(0, 10), until: e.toISOString().slice(0, 10) });
    }

    if (entry.recurrence === 'monthly') {
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate()));
    } else if (intervalDays) {
      cur = new Date(cur.getTime() + intervalDays * 86400000);
    } else {
      break;
    }
  }

  return ranges;
}

// Merge overlapping date ranges (sorted by from)
function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from));
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].from <= last.until) {
      if (sorted[i].until > last.until) last.until = sorted[i].until;
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

// POST /api/calendar
router.post('/', auth, async (req, res) => {
  const { product_id, available_from, available_until, recurrence = 'none', recurrence_end } = req.body;

  if (!product_id || !available_from)
    return err(res, 400, 'product_id and available_from are required', 'validation_error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(available_from))
    return err(res, 400, 'available_from must be YYYY-MM-DD', 'validation_error');
  if (!['none', 'weekly', 'biweekly', 'monthly'].includes(recurrence))
    return err(res, 400, "recurrence must be 'none','weekly','biweekly','monthly'", 'validation_error');

  const { rows: pRows } = await db.query('SELECT farmer_id FROM products WHERE id = $1', [product_id]);
  if (!pRows.length) return err(res, 404, 'Product not found', 'not_found');
  if (pRows[0].farmer_id !== req.user.id) return err(res, 403, 'Forbidden', 'forbidden');

  const { rows } = await db.query(
    `INSERT INTO availability_calendar
       (product_id, available_from, available_until, recurrence, recurrence_end, week_start, available)
     VALUES ($1, $2, $3, $4, $5, $2, 1) RETURNING id`,
    [product_id, available_from, available_until || null, recurrence, recurrence_end || null]
  );

  res.status(201).json({ success: true, id: rows[0].id });
});

// GET /api/calendar?product_id=:id&month=YYYY-MM
router.get('/', async (req, res) => {
  const { product_id, month } = req.query;
  if (!product_id) return err(res, 400, 'product_id is required', 'validation_error');
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    return err(res, 400, 'month must be YYYY-MM', 'validation_error');

  const [year, mon] = month.split('-').map(Number);

  const { rows } = await db.query(
    `SELECT id, available_from, available_until, recurrence, recurrence_end, delete_instance_date
     FROM availability_calendar
     WHERE product_id = $1
       AND (available_until IS NULL OR available_until >= $2)
       AND (recurrence_end IS NULL OR recurrence_end >= $2)
       AND available_from <= $3`,
    [product_id,
     new Date(Date.UTC(year, mon - 1, 1)).toISOString().slice(0, 10),
     new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10)]
  );

  const allRanges = rows.flatMap((entry) => expandEntry(entry, year, mon));
  const merged = mergeRanges(allRanges);

  res.json({ success: true, data: merged });
});

// DELETE /api/calendar/:id?delete_mode=series|instance&instance_date=YYYY-MM-DD
router.delete('/:id', auth, async (req, res) => {
  const calId = parseInt(req.params.id, 10);
  const { delete_mode = 'series', instance_date } = req.query;

  const { rows } = await db.query(
    `SELECT ac.*, p.farmer_id FROM availability_calendar ac
     JOIN products p ON ac.product_id = p.id
     WHERE ac.id = $1`,
    [calId]
  );
  if (!rows.length) return err(res, 404, 'Calendar entry not found', 'not_found');
  if (rows[0].farmer_id !== req.user.id) return err(res, 403, 'Forbidden', 'forbidden');

  if (delete_mode === 'instance') {
    if (!instance_date || !/^\d{4}-\d{2}-\d{2}$/.test(instance_date))
      return err(res, 400, 'instance_date (YYYY-MM-DD) is required for instance delete', 'validation_error');
    await db.query('UPDATE availability_calendar SET delete_instance_date = $1 WHERE id = $2', [instance_date, calId]);
  } else {
    await db.query('DELETE FROM availability_calendar WHERE id = $1', [calId]);
  }

  res.json({ success: true });
});

module.exports = router;
