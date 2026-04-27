const cron = require('node-cron');
const logger = require('../logger');
const db = require('../db/schema');

async function cleanupExpiredPushSubscriptions() {
  const query = db.isPostgres
    ? "DELETE FROM push_subscriptions WHERE created_at < NOW() - INTERVAL '90 days'"
    : "DELETE FROM push_subscriptions WHERE created_at < datetime('now', '-90 days')";

  const result = await db.query(query);
  const count = db.isPostgres ? result.rowCount : result.changes;
  if (count > 0) {
    logger.info(`[push-cleanup] Removed ${count} expired push subscription(s)`);
  }
  return count;
}

function startPushSubscriptionCleanup() {
  // Run daily at 02:00 UTC
  cron.schedule('0 2 * * *', () => {
    cleanupExpiredPushSubscriptions().catch((e) =>
      logger.error('[push-cleanup] Job error:', { error: e.message })
    );
  });
  logger.info('[push-cleanup] Daily cleanup job scheduled (02:00 UTC)');
}

module.exports = { startPushSubscriptionCleanup, cleanupExpiredPushSubscriptions };
