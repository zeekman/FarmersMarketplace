require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

require('./config'); // validate env vars before anything else
const app = require('./app');
const logger = require('./logger');
const cron = require('node-cron');
const { startSubscriptionJob } = require('./jobs/processSubscriptions');
const { startProductViewsAggJob } = require('./jobs/aggregateProductViews');
const { startFreshnessJob } = require('./jobs/processFreshnessAlerts');
const { startContractMonitor } = require('./jobs/contractMonitor');
const { startPushSubscriptionCleanup } = require('./jobs/cleanupPushSubscriptions');
const { startExpiryJob } = require('./jobs/deactivateExpiredProducts');
const { createBackup } = require('./scripts/backup');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend running on http://localhost:${PORT}`);
  startSubscriptionJob();
  startProductViewsAggJob();
  startFreshnessJob();
  startContractMonitor();
  startPushSubscriptionCleanup();
  startExpiryJob();
  
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
