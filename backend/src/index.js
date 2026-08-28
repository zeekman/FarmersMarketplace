require('./config'); // validate env vars before anything else
const app = require('./app');
const logger = require('./logger');
const cron = require('node-cron');
const { startSubscriptionJob } = require('./jobs/processSubscriptions');
const { startProductViewsAggJob } = require('./jobs/aggregateProductViews');
const { startFreshnessJob } = require('./jobs/processFreshnessAlerts');
const { startContractMonitor } = require('./jobs/contractMonitor');
const { startContractRegistrySync } = require('./jobs/contractRegistrySync');
const { startPushSubscriptionCleanup } = require('./jobs/cleanupPushSubscriptions');
const { startExpiryJob } = require('./jobs/deactivateExpiredProducts');
const { startAnonymizeJob } = require('./jobs/anonymizeDeactivatedUsers');
const { startAuctionJob } = require('./jobs/auctionCron');
const { createBackup } = require('./scripts/backup');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend running on http://localhost:${PORT}`);
  startSubscriptionJob();
  startProductViewsAggJob();
  startFreshnessJob();
  startContractMonitor();
  startContractRegistrySync();
  startPushSubscriptionCleanup();
  startAnonymizeJob();
  startExpiryJob();
  startAuctionJob();

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
