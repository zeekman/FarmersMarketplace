'use strict';

/**
 * Admin-only HTTP endpoints for orphaned-upload reconciliation.
 *
 * GET  /api/admin/uploads/orphaned?dryRun=true  — report mode (no deletions)
 * DELETE /api/admin/uploads/orphaned            — live mode (deletes orphans)
 *
 * #1025
 */

const router = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const { reconcileOrphanedUploads } = require('../jobs/reconcileOrphanedUploads');

/**
 * GET /api/admin/uploads/orphaned
 *
 * Returns a report of orphaned upload files without deleting them.
 * Pass ?dryRun=false to trigger live deletion via GET (not recommended; use DELETE instead).
 */
router.get('/orphaned', adminAuth, async (req, res) => {
  const dryRun = req.query.dryRun !== 'false'; // default to dry-run

  try {
    const report = await reconcileOrphanedUploads({ dryRun });
    return res.json({
      success: true,
      dryRun,
      orphanedCount: report.orphaned.length,
      keptCount: report.kept.length,
      deleted: report.deleted,
      orphaned: report.orphaned,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, code: 'reconcile_failed' });
  }
});

/**
 * DELETE /api/admin/uploads/orphaned
 *
 * Identifies and removes all orphaned upload files.
 */
router.delete('/orphaned', adminAuth, async (req, res) => {
  try {
    const report = await reconcileOrphanedUploads({ dryRun: false });
    return res.json({
      success: true,
      deleted: report.deleted,
      orphanedCount: report.orphaned.length,
      orphaned: report.orphaned,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, code: 'reconcile_failed' });
  }
});

module.exports = router;
