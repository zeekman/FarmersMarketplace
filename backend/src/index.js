require('./config'); // validate env vars before anything else
const app = require('./app');
const logger = require('./logger');
const cron = require('node-cron');
const { startSubscriptionJob } = require('./jobs/processSubscriptions');
const { startFreshnessJob } = require('./jobs/processFreshnessAlerts');
const { startContractMonitor } = require('./jobs/contractMonitor');
const { createBackup } = require('./scripts/backup');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend running on http://localhost:${PORT}`);
  startSubscriptionJob();
  startFreshnessJob();
  startContractMonitor();
  
  // Schedule daily backup at midnight
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
  
  // Schedule daily backup at midnight
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
