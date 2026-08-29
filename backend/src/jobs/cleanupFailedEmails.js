const cron = require('node-cron');
const db = require('../db/schema');
const logger = require('../logger');

/**
 * Cleanup failed emails older than the retention period
 * @param {number} retentionDays - Number of days to retain failed email records
 * @returns {number} Number of records deleted
 */
async function cleanupFailedEmails(retentionDays = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffIso = cutoffDate.toISOString();

  logger.info(`[cleanup-failed-emails] Pruning failed emails older than ${retentionDays} days (before ${cutoffIso})`);

  const result = db.prepare(`
    DELETE FROM failed_emails 
    WHERE created_at < ?
  `).run(cutoffIso);

  const deletedCount = result.changes;
  if (deletedCount > 0) {
    logger.info(`[cleanup-failed-emails] Pruned ${deletedCount} old failed email record(s)`);
  } else {
    logger.info(`[cleanup-failed-emails] No old failed email records to prune`);
  }

  return deletedCount;
}

/**
 * Start the cleanup job as a scheduled cron task
 */
function startFailedEmailCleanupJob() {
  const retentionDays = parseInt(process.env.FAILED_EMAIL_RETENTION_DAYS || '7', 10);

  // Run daily at 2:00 AM to avoid peak usage
  cron.schedule('0 2 * * *', () => {
    cleanupFailedEmails(retentionDays).catch(e =>
      logger.error('[cleanup-failed-emails] Job error', { error: e.message })
    );
  });

  logger.info(`[cleanup-failed-emails] Cleanup job scheduled (daily at 2:00 AM, ${retentionDays}-day retention)`);
}

module.exports = { startFailedEmailCleanupJob, cleanupFailedEmails };