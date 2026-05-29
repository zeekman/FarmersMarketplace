const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const db = require('../db/schema');
const { Server } = require('@stellar/stellar-sdk');

// ============================================================================
// Rate Limiters
// ============================================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10'),
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

async function checkStellarHorizon() {
  const startTime = Date.now();
  try {
    const horizonUrl = process.env.STELLAR_HORIZON_URL || 
      (process.env.STELLAR_NETWORK === 'mainnet' 
        ? 'https://horizon.stellar.org' 
        : 'https://horizon-testnet.stellar.org');
    const server = new Server(horizonUrl);
    await server.root();
    const duration = Date.now() - startTime;
    return { status: 'ok', responseTime: `${duration}ms` };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Stellar Horizon health check failed:', { error: error.message });
    return { status: 'down', responseTime: `${duration}ms`, error: error.message };
  }
}

async function checkSorobanRPC() {
  const startTime = Date.now();
  try {
    const sorobanUrl = process.env.SOROBAN_RPC_URL;
    if (!sorobanUrl) {
      return { status: 'not_configured', responseTime: '0ms' };
    }
    
    const https = require('https');
    const url = new URL(sorobanUrl);
    
    const postData = JSON.stringify({ 
      jsonrpc: '2.0', 
      id: 1, 
      method: 'getHealth' 
    });
    
    return new Promise((resolve) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const duration = Date.now() - startTime;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const result = JSON.parse(data);
              resolve({ status: 'ok', responseTime: `${duration}ms`, details: result });
            } catch (parseError) {
              resolve({ status: 'down', responseTime: `${duration}ms`, error: 'Invalid JSON response' });
            }
          } else {
            resolve({ status: 'down', responseTime: `${duration}ms`, error: `HTTP ${res.statusCode}` });
          }
        });
      });
      
      req.on('error', (error) => {
        const duration = Date.now() - startTime;
        logger.error('Soroban RPC health check failed:', { error: error.message });
        resolve({ status: 'down', responseTime: `${duration}ms`, error: error.message });
      });
      
      req.write(postData);
      req.end();
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Soroban RPC health check failed:', { error: error.message });
    return { status: 'down', responseTime: `${duration}ms`, error: error.message };
  }
}

// ============================================================================
// Health Endpoint Handler
// ============================================================================

async function getHealthCheckResponse(includeVersion = false) {
  const startTime = Date.now();
  try {
    const [dbCheck, horizonCheck, sorobanCheck] = await Promise.all([
      checkDatabase(),
      checkStellarHorizon(),
      checkSorobanRPC()
    ]);
    
    const checks = {
      database: dbCheck,
      horizon: horizonCheck,
      soroban: sorobanCheck
    };
    
    const criticalDown = [dbCheck.status, horizonCheck.status].some(status => status === 'down');
    const overallStatus = criticalDown ? 'down' : 'ok';
    
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
 * Add deprecation warning headers to /api endpoints
 * Clients should migrate to /api/v1
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
router.get('/robots.txt', (_, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/sitemap.xml`
  );
});

// ============================================================================
// Health Endpoints (both versions)
// ============================================================================

router.get('/api/health', async (req, res) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('X-API-Warn', 'Use /api/v1/health instead');
  const { healthData, statusCode } = await getHealthCheckResponse(false);
  res.status(statusCode).json(healthData);
});

router.get('/api/v1/health', async (req, res) => {
  const { healthData, statusCode } = await getHealthCheckResponse(true);
  res.status(statusCode).json(healthData);
});

// ============================================================================
// Rate Limiters Setup
// ============================================================================

router.use('/api', generalLimiter);
router.use('/api/v1', generalLimiter);
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
registerRoute('/', '/products', require('./products'));
registerRoute('/', '/orders', require('./orders'));
registerRoute('/', '/orders/:id/return', require('./returns'));
registerRoute('/', '/waitlist', require('./waitlist'));
registerRoute('/', '/wallet', require('./wallet'));
registerRoute('/', '/cooperatives', require('./cooperatives'));
registerRoute('/', '/analytics', require('./analytics'));
registerRoute('/', '/admin', require('./admin'));
registerRoute('/', '/farmers', require('./farmers'));
registerRoute('/', '/rates', require('./rates'));
registerRoute('/', '/recommendations', require('./recommendations'));
registerRoute('/', '/favorites', require('./favorites'));
registerRoute('/', '/addresses', require('./addresses'));
registerRoute('/', '/messages', require('./messages'));
registerRoute('/', '/notifications', require('./notifications'));
registerRoute('/', '/contracts', require('./contracts'));
registerRoute('/', '/products/bulk', require('./bulkUpload'));
registerRoute('/', '/coupons', require('./coupons'));
registerRoute('/', '/alerts', require('./alerts'));
registerRoute('/', '/products/import', require('./productImport'));
registerRoute('/', '', require('./reviews'));
registerRoute('/', '', require('./network'));
registerRoute('/', '/batches', require('./batches'));
registerRoute('/', '/products/flashSales', require('./flashSales'));
registerRoute('/', '/products/videos', require('./productVideos'));
registerRoute('/', '/products/:id/calendar', require('./calendar'));
registerRoute('/', '/orders/budget', require('./orderBudgetGuard'));
registerRoute('/', '/wallet/budget', require('./walletBudget'));
registerRoute('/', '/products/share', require('./productShare'));
registerRoute('/', '/products/market', require('./market'));
registerRoute('/', '/subscriptions', require('./subscriptions').router);
registerRoute('/', '/bundles', require('./bundles'));
registerRoute('/', '/farmers/bundles', require('./bundleDiscounts'));
registerRoute('/', '', require('./export'));
registerRoute('/', '/announcements', require('./announcements'));
registerRoute('/', '/auctions', require('./auctions'));

module.exports = router;
