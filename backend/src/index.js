require('./config'); // validate env vars before anything else
const { validateStellarConfig } = require('./utils/stellar-config');
validateStellarConfig(); // fail fast on missing Stellar/Soroban config
const app = require('./app');
const logger = require('./logger');
const cron = require('node-cron');
const { startSubscriptionJob } = require('./jobs/processSubscriptions');
const { startFailedEmailCleanupJob } = require('./jobs/cleanupFailedEmails');
const { startProductViewsAggJob } = require('./jobs/aggregateProductViews');
const { startFreshnessJob } = require('./jobs/processFreshnessAlerts');
const { startContractMonitor } = require('./jobs/contractMonitor');
const { startContractRegistrySync } = require('./jobs/contractRegistrySync');
const { startCreatorEarningsMonitor } = require('./jobs/creatorEarningsMonitor');
const { startPushSubscriptionCleanup } = require('./jobs/cleanupPushSubscriptions');
const { startExpiryJob } = require('./jobs/deactivateExpiredProducts');
const { startAnonymizeJob } = require('./jobs/anonymizeDeactivatedUsers');
const { createBackup } = require('./scripts/backup');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend running on http://localhost:${PORT}`);
  startSubscriptionJob();
  startFailedEmailCleanupJob();
  startProductViewsAggJob();
  startFreshnessJob();
  startContractMonitor();
  startContractRegistrySync();
  startCreatorEarningsMonitor();
  startPushSubscriptionCleanup();
  startAnonymizeJob();
  startExpiryJob();

  cron.schedule('0 0 * * *', async () => {
    logger.info('Starting scheduled daily backup');
    try {
      await createBackup();
      logger.info('Daily backup completed successfully');
    } catch (error) {
      logger.error('Daily backup failed:', { error: error.message });
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  logger.info('Daily backup cron job scheduled at midnight UTC');
});
