const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const authMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10');
const generalMax = parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '100');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts, try again later', code: 'rate_limited' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: generalMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, slow down', code: 'rate_limited' },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many orders, slow down', code: 'rate_limited' },
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
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many send requests, slow down', code: 'rate_limited' },
});

// Health check — exempt from rate limiting
router.get('/api/health', (_, res) => res.json({ status: 'ok' }));
router.get('/api/v1/health', (_, res) => res.json({ status: 'ok', version: 'v1' }));

// Apply general limiter to all /api/* routes
router.use('/api', generalLimiter);

// Stricter auth limiter
router.use('/api/v1/auth/login', authLimiter);
router.use('/api/v1/auth/register', authLimiter);
router.use('/api/auth/login', authLimiter);
router.use('/api/auth/register', authLimiter);
router.use('/api/auth/refresh', authLimiter);

// Resource-specific limiters
router.use('/api/v1/orders', orderLimiter);
router.use('/api/orders', orderLimiter);
router.use('/api/v1/wallet/fund', fundLimiter);
router.use('/api/wallet/fund', fundLimiter);
router.use('/api/wallet/send', sendLimiter);

// Versioned routes
router.use('/api/v1/auth', require('./auth'));
router.use('/api/v1/products', require('./products'));
router.use('/api/v1/orders', require('./orders'));
router.use('/api/v1/wallet', require('./wallet'));
router.use('/api/v1/farmers', require('./farmers'));
router.use('/api/v1/rates', require('./rates'));
router.use('/api/v1', require('./reviews'));

// Non-versioned routes
router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/farmers', require('./farmers'));
router.use('/api/analytics', require('./analytics'));
router.use('/api/admin', require('./admin'));
router.use('/api/rates', require('./rates'));
router.use('/api/contracts', require('./contracts'));
router.use('/api', require('./reviews'));

module.exports = router;
