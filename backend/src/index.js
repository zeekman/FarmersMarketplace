require('./config'); // validate env vars before anything else
const { validateStellarConfig } = require('./utils/stellar-config');
validateStellarConfig(); // fail fast on missing Stellar/Soroban config
const app = require('./app');
const db = require('./db/schema');
const logger = require('./logger');
const { startJobs } = require('./jobs');
const PORT = process.env.PORT || 4000;

async function start() {
  await db.ready;
  const server = app.listen(PORT, () => {
    logger.info(`Backend running on http://localhost:${PORT}`);
    // Background jobs run only in the process started with RUN_JOBS=true (#1367).
    const stopJobs = startJobs();
    app.locals.startBackgroundJobs();

    if (process.send) {
      process.send('ready');
    }

    const shutdown = (signal) => {
      logger.info(`${signal} received, shutting down gracefully`);
      stopJobs();
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  });
}

start().catch((error) => {
  logger.error('Backend startup failed:', { error: error.message });
  process.exitCode = 1;
});
