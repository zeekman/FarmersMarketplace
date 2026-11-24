'use strict';

/**
 * Admin contract alerts (#1368) — mounted at /admin/contract-alerts.
 *
 *   GET          /                 — list alerts; ?acknowledged=true|false filters
 *   PATCH|POST   /:id/acknowledge  — mark an alert acknowledged
 *
 * Alerts are written by jobs/contractMonitor.js (see migration 034_contract_alerts).
 */

const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { err } = require('../middleware/error');

router.get('/', auth, requireAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const params = [];
  let where = '';
  if (req.query.acknowledged === 'true' || req.query.acknowledged === 'false') {
    params.push(req.query.acknowledged === 'true' ? 1 : 0);
    where = `WHERE acknowledged = $${params.length}`;
  }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT id, contract_id, alert_type, severity, message, acknowledged,
            acknowledged_by, acknowledged_at, created_at
     FROM contract_alerts
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  res.json({ success: true, data: rows.map((r) => ({ ...r, acknowledged: !!r.acknowledged })) });
});

async function acknowledge(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return err(res, 400, 'Invalid alert id', 'validation_error');

  const { rowCount } = await db.query(
    `UPDATE contract_alerts
     SET acknowledged = 1, acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND acknowledged = 0`,
    [req.user.id, id]
  );
  if (rowCount === 0) return err(res, 404, 'Alert not found or already acknowledged', 'not_found');
  res.json({ success: true });
}

router.patch('/:id/acknowledge', auth, requireAdmin, acknowledge);
router.post('/:id/acknowledge', auth, requireAdmin, acknowledge);

module.exports = router;
