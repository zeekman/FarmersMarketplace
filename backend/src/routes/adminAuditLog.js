'use strict';

/**
 * GET /api/admin/audit-log
 *
 * Returns a paginated, filterable view of the admin_audit_log table.
 * Admin-only endpoint.
 *
 * Query parameters:
 *   admin_id    — filter by acting admin user ID
 *   target_type — filter by entity type (e.g. 'user', 'dispute', 'contract')
 *   target_id   — filter by target entity ID
 *   action      — filter by action name
 *   from        — ISO 8601 start date (inclusive)
 *   to          — ISO 8601 end date (inclusive)
 *   page        — page number (default 1)
 *   limit       — results per page (default 50, max 200)
 *   format      — 'csv' for CSV export, omit for JSON
 *
 * #1028, BE-40
 */

const router = require('express').Router();
const db = require('../db/schema');
const adminAuth = require('../middleware/adminAuth');
const { stringify } = require('csv-stringify/sync');

router.get('/', adminAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const format = req.query.format; // 'csv' or undefined (JSON)

  const conditions = [];
  const params = [];

  const targetUserId = req.query.admin_id || req.query.user_id;
  if (targetUserId) {
    params.push(parseInt(targetUserId, 10));
    conditions.push(`a.admin_id = ${params.length}`);
  }

  if (req.query.target_type) {
    params.push(req.query.target_type);
    conditions.push(`a.target_type = ${params.length}`);
  }

  if (req.query.target_id) {
    params.push(String(req.query.target_id));
    conditions.push(`a.target_id = ${params.length}`);
  }

  if (req.query.action) {
    params.push(req.query.action);
    conditions.push(`a.action = ${params.length}`);
  }

  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`a.created_at >= ${params.length}`);
  }

  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`a.created_at <= ${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // BE-40: CSV export support
    if (format === 'csv') {
      const { rows } = await db.query(
        `SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id,
                a.before_val, a.after_val, a.ip_address, a.user_agent, a.request_id, a.created_at,
                u.name AS admin_name, u.email AS admin_email
         FROM admin_audit_log a
         JOIN users u ON a.admin_id = u.id
         ${where}
         ORDER BY a.created_at DESC`,
        params
      );

      const csvData = rows.map((row) => ({
        id: row.id,
        admin_id: row.admin_id,
        admin_name: row.admin_name,
        admin_email: row.admin_email,
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id,
        before: row.before_val || '',
        after: row.after_val || '',
        ip_address: row.ip_address || '',
        user_agent: row.user_agent || '',
        request_id: row.request_id || '',
        created_at: row.created_at,
      }));

      const csv = stringify(csvData, { header: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
      return res.send(csv);
    }

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id,
                a.before_val, a.after_val, a.ip_address, a.user_agent, a.request_id, a.created_at,
                u.name AS admin_name, u.email AS admin_email
         FROM admin_audit_log a
         JOIN users u ON a.admin_id = u.id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT ${params.length + 1} OFFSET ${params.length + 2}`,
        [...params, limit, offset],
      ),
      db.query(
        `SELECT COUNT(*) AS total FROM admin_audit_log a ${where}`,
        params,
      ),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? 0, 10);
    const pages = Math.max(1, Math.ceil(total / limit));

    const entries = dataResult.rows.map((row) => ({
      id: row.id,
      admin_id: row.admin_id,
      admin_name: row.admin_name,
      admin_email: row.admin_email,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      before: row.before_val ? JSON.parse(row.before_val) : null,
      after: row.after_val ? JSON.parse(row.after_val) : null,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      request_id: row.request_id,
      created_at: row.created_at,
    }));

    return res.json({
      success: true,
      entries,
      pagination: { page, pages, total, limit },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, code: 'db_error' });
  }
});

module.exports = router;
