const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const logger = require('../logger');
const db = require('../db/schema');
const { server: horizonServer, sorobanServer } = require('../utils/stellar-config');

// ============================================================================
// Rate Limiter Stores
// ============================================================================

// Shared counters so limits hold across cluster workers and restarts (#1457).
// Without REDIS_URL each process keeps its own MemoryStore (express-rate-limit default).
const rateLimitRedis = process.env.REDIS_URL
  ? new (require('ioredis'))(process.env.REDIS_URL, { enableOfflineQueue: false })
  : null;

if (rateLimitRedis) {
  rateLimitRedis.on('error', (error) => logger.error('Rate limit Redis error:', { error: error.message }));
} else if (process.env.NODE_ENV === 'production') {
  logger.warn('REDIS_URL is not set: rate limits use in-memory stores that reset on restart and are not shared across cluster workers');
}

// Fixed window: INCR and set the TTL on first hit, atomically in one script
const INCR_WITH_TTL_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { hits, redis.call('PTTL', KEYS[1]) }
`;

class RedisRateLimitStore {
  constructor(client, prefix, windowMs) {
    this.client = client;
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  async increment(key) {
    const [totalHits, ttl] = await this.client.eval(INCR_WITH_TTL_SCRIPT, 1, `${this.prefix}${key}`, this.windowMs);
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key) {
    await this.client.decr(`${this.prefix}${key}`);
  }

  async resetKey(key) {
    await this.client.del(`${this.prefix}${key}`);
  }
}

function redisStoreOptions(name, windowMs) {
  return rateLimitRedis
    ? { store: new RedisRateLimitStore(rateLimitRedis, `rl:${name}:`, windowMs) }
    : {};
}

// ============================================================================
// Rate Limiters
// ============================================================================

// Login is keyed on ip + email so one account can't be attacked from many IPs.
// Register, refresh and other auth paths stay keyed on ip alone.
function authRateLimitKey(req) {
  const ip = ipKeyGenerator(req.ip);
  const email = req.body?.email;
  if (!req.originalUrl.split('?')[0].endsWith('/auth/login') || typeof email !== 'string') {
    return ip;
  }
  const emailHash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `${ip}:${emailHash}`;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10'),
  keyGenerator: authRateLimitKey,
  ...redisStoreOptions('auth', 15 * 60 * 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many attempts, try again later',
    code: 'rate_limited',
  },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '100'),
  ...redisStoreOptions('general', 60 * 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, slow down',
    code: 'rate_limited',
  },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ORDER_MAX || '10'),
  ...redisStoreOptions('order', 60 * 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many orders, slow down',
    code: 'rate_limited',
  },
});

const fundLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  ...redisStoreOptions('fund', 60 * 60 * 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Funding limit reached, try again in an hour',
    code: 'rate_limited',
  },
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_SEND_MAX || '5'),
  ...redisStoreOptions('send', 60 * 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many send requests, slow down',
    code: 'rate_limited',
  },
});

// ============================================================================
// Health Checks
// ============================================================================

async function checkDatabase() {
  const startTime = Date.now();
  try {
    await db.query('SELECT 1');
    const duration = Date.now() - startTime;
    return { status: 'ok', responseTime: `${duration}ms` };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Database health check failed:', { error: error.message });
    return { status: 'down', responseTime: `${duration}ms`, error: error.message };
  }
}

const HEALTH_CHECK_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkStellarHorizon(requestId) {
  const startTime = Date.now();
  try {
    await withTimeout(horizonServer.root(), HEALTH_CHECK_TIMEOUT_MS);
    const duration = Date.now() - startTime;
    logger.info(JSON.stringify({ requestId: requestId || null, event: 'horizon_health_check', status: 'ok', responseTime: `${duration}ms` }));
    return { status: 'ok', responseTime: `${duration}ms` };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Stellar Horizon health check failed:', { requestId: requestId || null, error: error.message });
    return { status: 'down', responseTime: `${duration}ms`, error: error.message };
  }
}

async function checkSorobanRPC(requestId) {
  const startTime = Date.now();
  try {
    if (!process.env.SOROBAN_RPC_URL) {
      return { status: 'not_configured', responseTime: '0ms' };
    }
    const health = await withTimeout(sorobanServer.getHealth(), HEALTH_CHECK_TIMEOUT_MS);
    const duration = Date.now() - startTime;
    return { status: 'ok', responseTime: `${duration}ms`, details: health };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Soroban RPC health check failed:', { requestId: requestId || null, error: error.message });
    return { status: 'down', responseTime: `${duration}ms`, error: error.message };
  }
}

async function checkRedis() {
  const startTime = Date.now();
  try {
    if (!process.env.REDIS_URL) {
      return { status: 'not_configured', responseTime: '0ms' };
    }
    let Redis;
    try {
      Redis = require('ioredis');
    } catch {
      return { status: 'not_available', responseTime: '0ms', error: 'ioredis not installed' };
    }
    const testClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3000
    });
    await testClient.ping();
    testClient.disconnect();
    const duration = Date.now() - startTime;
    return { status: 'ok', responseTime: `${duration}ms` };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Redis health check failed:', { error: error.message });
    return { status: 'down', responseTime: `${duration}ms`, error: error.message };
  }
}

// ============================================================================
// Health Endpoint Handler
// ============================================================================

async function getHealthCheckResponse(includeVersion = false, requestId) {
  const startTime = Date.now();
  try {
    const [dbCheck, horizonCheck, sorobanCheck, redisCheck] = await Promise.all([
      checkDatabase(),
      checkStellarHorizon(requestId),
      checkSorobanRPC(requestId),
      checkRedis()
    ]);

    const checks = {
      database: dbCheck,
      horizon: horizonCheck,
      soroban: sorobanCheck,
      redis: redisCheck
    };
    
    const anyDown = Object.values(checks).some(check => check.status === 'down');
    const overallStatus = anyDown ? 'down' : 'ok';
    
    const uptime = process.uptime();
    const responseTime = Date.now() - startTime;
    
    const healthData = {
      status: overallStatus,
      uptime: Math.floor(uptime),
      responseTime: `${responseTime}ms`,
      checks,
      timestamp: new Date().toISOString()
    };

    if (includeVersion) {
      healthData.version = 'v1';
    }

    return { healthData, statusCode: overallStatus === 'down' ? 503 : 200 };
  } catch (error) {
    logger.error('Health check error:', { error: error.message });
    return {
      healthData: {
        status: 'down',
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
        ...(includeVersion && { version: 'v1' })
      },
      statusCode: 503
    };
  }
}

// ============================================================================
// Deprecation Middleware
// ============================================================================

/**
 * Fixed sunset date for the deprecated API v0 surface.
 *
 * Sourced from config (`API_V0_SUNSET`, default `2027-03-31`) so the value is
 * stable across requests and clients can plan a migration. Previously this was
 * computed as `now + 180 days` on every request, which meant the sunset date
 * never actually arrived.
 */
const API_V0_SUNSET = process.env.API_V0_SUNSET || '2027-03-31';

/**
 * Add deprecation warning headers to a response.
 */
function addDeprecationHeaders(req, res, next) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toUTCString()); // 6 months
  res.setHeader('X-API-Warn', 'The /api endpoint prefix is deprecated. Please use /api/v1 instead.');
  next();
}

// ============================================================================
// SEO Endpoints (non-versioned)
// ============================================================================

router.get('/sitemap.xml', require('./sitemap'));
router.use('/seo', require('./seo'));
router.get('/robots.txt', (req, res) => {
  const host = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${host}/sitemap.xml`
  );
});

// ============================================================================
// Health Endpoints (both versions)
// ============================================================================

router.get('/api/health', async (req, res) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('X-API-Warn', 'Use /api/v1/health instead');
  const { healthData, statusCode } = await getHealthCheckResponse(false, req.requestId);
  res.status(statusCode).json(healthData);
});

router.get('/api/v1/health', async (req, res) => {
  const { healthData, statusCode } = await getHealthCheckResponse(true, req.requestId);
  res.status(statusCode).json(healthData);
});

// ============================================================================
// Rate Limiters Setup
// ============================================================================

router.use('/api', generalLimiter);
router.use('/api/auth/login', authLimiter);
router.use('/api/auth/register', authLimiter);
router.use('/api/auth/refresh', authLimiter);
router.use('/api/v1/auth/login', authLimiter);
router.use('/api/v1/auth/register', authLimiter);
router.use('/api/v1/auth/refresh', authLimiter);
router.use('/api/orders', orderLimiter);
router.use('/api/v1/orders', orderLimiter);
router.use('/api/wallet/fund', fundLimiter);
router.use('/api/v1/wallet/fund', fundLimiter);
router.use('/api/wallet/send', sendLimiter);
router.use('/api/v1/wallet/send', sendLimiter);

// ============================================================================
// Helper Function to Register Routes for Both Versions
// ============================================================================

/**
 * Register a route for both /api and /api/v1 versions
 * Automatically adds deprecation headers to /api routes
 */
function registerRoute(basePrefix, path, handler) {
  // Register /api version with deprecation headers
  router.use(`/api${path}`, addDeprecationHeaders, handler);

  // Register /api/v1 version
  router.use(`/api/v1${path}`, handler);
}

/**
 * Register a deprecated alias path for both /api and /api/v1 versions.
 * Unlike registerRoute, both versions get deprecation headers since the
 * path itself (not just the unversioned prefix) is deprecated.
 */
function registerDeprecatedAlias(path, handler) {
  router.use(`/api${path}`, addDeprecationHeaders, handler);
  router.use(`/api/v1${path}`, addDeprecationHeaders, handler);
}

// ============================================================================
// Routes Registration
// ============================================================================

// Non-prefixed routes (CSV token, federation, etc.)
router.get('/.well-known/stellar.toml', (req, res) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
  const passphrase =
    process.env.STELLAR_NETWORK === 'mainnet'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(`FEDERATION_SERVER="${backendUrl}/federation"\nNETWORK_PASSPHRASE="${passphrase}"\n`);
});

router.use('/federation', require('./federation'));

// API Routes - registered for both /api and /api/v1
registerRoute('/', '/auth', require('./auth'));
// Fixed /products paths must precede products.js, whose /:id handlers would swallow them (#1368)
registerRoute('/', '/products', require('./productExtras'));
registerRoute('/', '/products/bulk', require('./bulkUpload'));
registerRoute('/', '/products/import', require('./productImport'));
registerRoute('/', '/products', require('./productVideos'));
registerRoute('/', '/products', require('./flashSales'));
registerRoute('/', '/products/:id/calendar', require('./calendar'));
registerRoute('/', '/products', require('./productShare'));
registerRoute('/', '/products/market', require('./market'));
registerRoute('/', '/auth', require('./emailVerification'));
registerRoute('/', '/auth', require('./authPasswordReset'));
registerRoute('/', '/products', require('./products'));
registerRoute('/', '/orders', require('./orderBudgetGuard'));
registerRoute('/', '/orders', require('./orderReceipt'));
registerRoute('/', '/orders', require('./orders'));
registerRoute('/', '/rewards', require('./rewards'));
registerRoute('/', '/orders/:id/return', require('./returns'));
registerRoute('/', '/disputes', require('./disputes'));
registerRoute('/', '/waitlist', require('./waitlist'));
registerRoute('/', '/wallet/alerts', require('./walletAlerts'));
registerRoute('/', '/wallet', require('./wallet'));
registerRoute('/', '/cooperatives', require('./cooperatives'));
registerRoute('/', '/analytics', require('./analytics'));
registerRoute('/', '/admin/contract-alerts', require('./adminContractAlerts'));
registerRoute('/', '/admin', require('./admin'));
registerRoute('/', '/admin', require('./adminBan'));
registerRoute('/', '/admin/audit-log', require('./adminAuditLog'));
registerRoute('/', '/admin/uploads', require('./adminOrphanedUploads'));
registerRoute('/', '/farmers', require('./farmers'));
registerRoute('/', '/rates', require('./rates'));
registerRoute('/', '/recommendations', require('./recommendations'));
registerRoute('/', '/favorites', require('./favorites'));
registerRoute('/', '/addresses', require('./addresses'));
registerRoute('/', '/messages', require('./messages'));
registerRoute('/', '/notifications', require('./notifications'));
registerRoute('/', '/contracts', require('./contracts'));
registerRoute('/', '/escrow', require('./escrow'));
registerRoute('/', '/creator-earnings', require('./creatorEarnings'));
// /payment-streams is the canonical kebab-case prefix for the payment-streaming
// feature; /paymentStreams and /streams are kept working as deprecated aliases.
registerRoute('/', '/payment-streams', require('./streams'));
registerDeprecatedAlias('/streams', require('./streams'));
registerDeprecatedAlias('/paymentStreams', require('./paymentStreams'));
registerRoute('/', '/coupons', require('./coupons'));
registerRoute('/', '/alerts', require('./alerts'));
const reviewRoutes = require('./reviews');
registerRoute('/', '/reviews', reviewRoutes);
registerRoute('/', '/admin/reviews', reviewRoutes.adminRouter);
registerRoute('/', '/products', reviewRoutes.productRouter);
registerRoute('/', '/network', require('./network'));
registerRoute('/', '/batches', require('./batches'));
registerRoute('/', '/wallet', require('./walletBudget'));
registerRoute('/', '/market', require('./market'));
registerRoute('/', '/subscriptions', require('./subscriptions').router);
registerRoute('/', '/bundles', require('./bundles'));
registerRoute('/', '/farmers/bundles', require('./bundleDiscounts'));
const exportRoutes = require('./export');
registerRoute('/', '/products', exportRoutes.productsRouter);
registerRoute('/', '/orders', exportRoutes.ordersRouter);
registerRoute('/', '/announcements', require('./announcements'));
registerRoute('/', '/auctions', require('./auctions'));

registerRoute('/', '/categories', require('./categories'));

router.closeRedis = async () => {
  if (!rateLimitRedis) return;
  try { await rateLimitRedis.quit(); } catch { rateLimitRedis.disconnect(); }
};

module.exports = router;
