const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const logger = require("../logger");
const db = require("../db/schema");
const { Server } = require("@stellar/stellar-sdk");
const router = require('express').Router();
const rateLimit = require('express-rate-limit');

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

// Health checks
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
    
    return new Promise((resolve, reject) => {
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

router.get("/api/health", async (req, res) => {
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
    
    // Determine overall status
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
    
    if (overallStatus === 'down') {
      logger.warn('Health check failed:', healthData);
      return res.status(503).json(healthData);
    }
    
    res.json(healthData);
  } catch (error) {
    logger.error('Health check error:', { error: error.message });
    res.status(503).json({
      status: 'down',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

router.get("/api/v1/health", async (req, res) => {
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
      version: 'v1',
      uptime: Math.floor(uptime),
      responseTime: `${responseTime}ms`,
      checks,
      timestamp: new Date().toISOString()
    };
    
    if (overallStatus === 'down') {
      return res.status(503).json(healthData);
    }
    
    res.json(healthData);
  } catch (error) {
    logger.error('Health check error:', { error: error.message });
    res.status(503).json({
      status: 'down',
      version: 'v1',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});
router.get('/api/health', (_, res) => res.json({ status: 'ok' }));
router.get('/api/v1/health', (_, res) => res.json({ status: 'ok', version: 'v1' }));

// SEO endpoints
router.get('/sitemap.xml', require('./sitemap'));
router.get('/robots.txt', (_, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/sitemap.xml`
  );
});

// Rate limiters
router.use('/api', generalLimiter);
router.use('/api/auth/login', authLimiter);
router.use('/api/auth/register', authLimiter);
router.use('/api/auth/refresh', authLimiter);
router.use('/api/v1/auth/login', authLimiter);
router.use('/api/v1/auth/register', authLimiter);
router.use('/api/orders', orderLimiter);
router.use('/api/v1/orders', orderLimiter);
router.use('/api/wallet/fund', fundLimiter);
router.use('/api/v1/wallet/fund', fundLimiter);
router.use('/api/wallet/send', sendLimiter);

// Export routes (must be before /products and /orders to avoid /:id catch-all)
router.use("/api", require("./export"));

// Routes
router.use("/api/auth", require("./auth"));
router.use("/api/products", require("./products"));
router.use("/api/batches", require("./batches"));
router.use("/api/products", require("./flashSales"));
router.use("/api/products", require("./productVideos"));
router.use("/api/products/:id/calendar", require("./calendar"));
router.use("/api/orders", require("./orderBudgetGuard"));
router.use("/api/orders", require("./orders"));
router.use("/api/waitlist", require("./waitlist"));
router.use("/api/wallet", require("./alerts"));
router.use("/api/wallet", require("./walletBudget"));
router.use("/api/products", require("./productShare"));
router.use("/api/products", require("./productVideos"));
router.use("/api/products/:id/calendar", require("./calendar"));
router.use("/api/orders", require("./orders"));
router.use("/api/waitlist", require("./waitlist"));
router.use("/api/wallet", require("./alerts"));
router.use("/api/wallet", require("./wallet"));
router.use("/api/cooperatives", require("./cooperatives"));
router.use("/api/analytics", require("./analytics"));
router.use("/api/admin", require("./admin"));
router.use("/api/farmers", require("./farmers"));
router.use("/api/rates", require("./rates"));
router.use("/api/favorites", require("./favorites"));
router.use("/api/addresses", require("./addresses"));
router.use("/api/messages", require("./messages"));
router.use("/api/notifications", require("./notifications"));
router.use("/api/contracts", require("./contracts"));
router.use("/api/products/bulk", require("./bulkUpload"));
router.use("/api/coupons", require("./coupons"));
router.use("/api/alerts", require("./alerts"));
router.use("/api/products/bulk", require("./bulkUpload"));
router.use("/api/products/import", require("./productImport"));
router.use("/api/coupons", require("./coupons"));
router.use("/api", require("./reviews"));
router.use('/api/auth',          require('./auth'));
router.use('/api/products',      require('./products'));
router.use('/api/products',      require('./productVideos'));
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/products', require('./flashSales'));
router.use('/api/products', require('./productVideos'));
router.use('/api/products/:id/calendar', require('./calendar'));
router.use('/api/orders', require('./orderBudgetGuard'));
router.use('/api/orders', require('./orders'));
router.use('/api/waitlist', require('./waitlist'));
router.use('/api/wallet', require('./alerts'));
router.use('/api/wallet', require('./walletBudget'));
router.use('/api/products', require('./productShare'));
router.use('/api/products', require('./productVideos'));
router.use('/api/products/:id/calendar', require('./calendar'));
router.use('/api/orders', require('./orders'));
router.use('/api/waitlist', require('./waitlist'));
router.use('/api/wallet', require('./alerts'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/cooperatives', require('./cooperatives'));
router.use('/api/analytics', require('./analytics'));
router.use('/api/admin', require('./admin'));
router.use('/api/farmers', require('./farmers'));
router.use('/api/rates', require('./rates'));
router.use('/api/recommendations', require('./recommendations'));
router.use('/api/favorites', require('./favorites'));
router.use('/api/addresses', require('./addresses'));
router.use('/api/messages', require('./messages'));
router.use('/api/notifications', require('./notifications'));
router.use('/api/contracts', require('./contracts'));
router.use('/api/products/bulk', require('./bulkUpload'));
router.use('/api/coupons', require('./coupons'));
router.use('/api/alerts', require('./alerts'));
router.use('/api/products/bulk', require('./bulkUpload'));
router.use('/api/products/import', require('./productImport'));
router.use('/api/coupons', require('./coupons'));
router.use('/api', require('./reviews'));
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/products', require('./productVideos'));
router.use('/api/products/:id/calendar', require('./calendar'));
router.use('/api/orders', require('./orders'));
router.use('/api/orders/:id/return', require('./returns'));
router.use('/api/waitlist', require('./waitlist'));
router.use('/api/wallet', require('./alerts'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/cooperatives', require('./cooperatives'));
router.use('/api/analytics', require('./analytics'));
router.use('/api/admin', require('./admin'));
router.use('/api/farmers', require('./farmers'));
router.use('/api/farmers', require('./bundleDiscounts'));
router.use('/api/rates', require('./rates'));
router.use('/api/recommendations', require('./recommendations'));
router.use('/api/favorites', require('./favorites'));
router.use('/api/addresses', require('./addresses'));
router.use('/api/messages', require('./messages'));
router.use('/api/notifications', require('./notifications'));
router.use('/api/contracts', require('./contracts'));
router.use('/api/products/bulk', require('./bulkUpload'));
router.use('/api/coupons', require('./coupons'));
router.use('/api/alerts', require('./alerts'));
router.use('/api/products/bulk', require('./bulkUpload'));
router.use('/api/products/import', require('./productImport'));
router.use('/api/coupons', require('./coupons'));
router.use('/api', require('./reviews'));

// Versioned aliases
router.use('/api/v1/auth', require('./auth'));
router.use('/api/v1/products', require('./products'));
router.use('/api/v1/orders', require('./orders'));
router.use('/api/v1/waitlist', require('./waitlist'));
router.use('/api/v1/wallet', require('./wallet'));
router.use('/api/v1/farmers', require('./farmers'));
router.use('/api/v1/rates', require('./rates'));
router.use('/api/v1/favorites', require('./favorites'));
router.use('/api/v1', require('./reviews'));

// QR code endpoint
router.use('/api/products', require('./market'));
// Non-versioned routes
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/subscriptions', require('./subscriptions').router);
router.use('/api/wallet', require('./wallet'));
router.use('/api/analytics', require('./analytics'));
router.use('/api/admin', require('./admin'));
router.use('/api/farmers', require('./farmers'));
router.use('/api/rates', require('./rates'));
router.use('/api/recommendations', require('./recommendations'));
router.use('/api', require('./reviews'));
router.use('/api/favorites', require('./favorites'));
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/bundles', require('./bundles'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/analytics', require('./analytics'));
router.use('/api/admin', require('./admin'));
router.use('/api/farmers', require('./farmers'));
router.use('/api/rates', require('./rates'));
router.use('/api/recommendations', require('./recommendations'));
router.use('/api', require('./reviews'));
router.use('/api/favorites', require('./favorites'));
router.use('/api/rates', require('./rates'));
router.use('/api/recommendations', require('./recommendations'));
router.use('/api', require('./reviews'));

// QR code endpoint (mounted under products so /:id/qr resolves correctly)
router.use('/api/products', require('./market'));

// Stellar federation
router.use('/federation', require('./federation'));

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

// Legacy routes
router.use("/api/auth", require("./auth"));
router.use("/api/products", require("./products"));
router.use("/api/orders", require("./orders"));
router.use("/api/wallet", require("./wallet"));
router.use("/api/contracts", require("./contracts"));
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/contracts', require('./contracts'));

router.get('/api/health', (_, res) => res.json({ status: 'ok' }));
router.get('/api/health', (_, res) => res.json({ status: 'ok' }));
router.get('/api/v1/health', (_, res) => res.json({ status: 'ok', version: 'v1' }));

module.exports = router;

// Non-versioned routes (used by frontend)
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/analytics', require('./analytics'));
// Unversioned routes under /api
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/farmers', require('./farmers'));

router.get('/api/health', (_, res) => res.json({ status: 'ok' }));
router.use('/api', require('./reviews'));
router.use('/api/addresses', require('./addresses'));
router.use('/api/products/bulk', require('./bulkUpload'));
router.use('/api/messages', require('./messages'));

router.get('/api/health', (_, res) => res.json({ status: 'ok' }));

router.use('/api/announcements', require('./announcements'));

module.exports = router;
