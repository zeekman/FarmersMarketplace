require('./config'); // validate env vars before anything else
const { validateStellarConfig } = require('./utils/stellar-config');
validateStellarConfig(); // fail fast on missing Stellar/Soroban config
const app = require('./app');
const db = require('./db/schema');
const logger = require('./logger');
const { startJobs } = require('./jobs');
const cache = require('./cache');
const realtime = require('./utils/realtime');
const sse = require('./utils/sse');
const routes = require('./routes');
const PORT = process.env.PORT || 4000;

async function start() {
  await db.ready;
  const server = app.listen(PORT, () => {
    logger.info(`Backend running on http://localhost:${PORT}`);
    // The jobs/index.js registry is the only scheduler, and it only schedules
    // anything when RUN_JOBS=true (the single jobs leader) — #1367/#011.
    const stopJobs = startJobs();

    if (process.send) {
      process.send('ready');
    }

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received, shutting down gracefully`);
      app.locals.isDraining = true;
      stopJobs();
      sse.closeAll('shutdown');
      server.close();
      const graceMs = Math.max(0, parseInt(process.env.SHUTDOWN_GRACE_MS || '10000', 10));
      let hardTimer;
      const hardTimeout = new Promise((resolve) => {
        hardTimer = setTimeout(() => resolve(false), graceMs);
      });
      const drained = app.locals.waitForInflight().then(() => true);
      const completed = await Promise.race([drained, hardTimeout]);
      clearTimeout(hardTimer);
      if (!completed) {
        logger.error('Shutdown grace period exceeded');
        process.exitCode = 1;
      }
      await Promise.allSettled([
        db.close?.(),
        cache.close?.(),
        realtime.close?.(),
        routes.closeRedis?.(),
      ]);
      logger.info('HTTP server closed');
      process.exit(completed ? 0 : 1);
    };
    process.once('SIGTERM', () => { shutdown('SIGTERM').catch((error) => { logger.error('Shutdown failed', { error }); process.exit(1); }); });
    process.once('SIGINT', () => { shutdown('SIGINT').catch((error) => { logger.error('Shutdown failed', { error }); process.exit(1); }); });
  });
}

start().catch((error) => {
  logger.error('Backend startup failed:', { error: error.message });
  process.exitCode = 1;
});
