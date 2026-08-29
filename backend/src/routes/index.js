const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts, try again later', code: 'rate_limited' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, slow down', code: 'rate_limited' },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ORDER_MAX || '10'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many orders, slow down', code: 'rate_limited' },
});

const fundLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Funding limit reached, try again in an hour', code: 'rate_limited' },
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_SEND_MAX || '5'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many send requests, slow down', code: 'rate_limited' },
});

router.get('/api/health', (_, res) => res.json({ status: 'ok' }));
router.get('/api/v1/health', (_, res) => res.json({ status: 'ok', version: 'v1' }));

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

router.use('/api/auth', require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders', require('./orders'));
router.use('/api/wallet', require('./wallet'));
router.use('/api/analytics', require('./analytics'));
router.use('/api/admin', require('./admin'));
router.use('/api/farmers', require('./farmers'));
router.use('/api/rates', require('./rates'));
router.use('/api/favorites', require('./favorites'));
router.use('/api/addresses', require('./addresses'));
router.use('/api/messages', require('./messages'));
router.use('/api/contracts', require('./contracts'));
router.use('/api/products/bulk', require('./bulkUpload'));
router.use('/api/coupons', require('./coupons'));
router.use('/api', require('./reviews'));

router.use('/api/v1/auth', require('./auth'));
router.use('/api/v1/products', require('./products'));
router.use('/api/v1/orders', require('./orders'));
router.use('/api/v1/wallet', require('./wallet'));
router.use('/api/v1/farmers', require('./farmers'));
router.use('/api/v1/rates', require('./rates'));
router.use('/api/v1/favorites', require('./favorites'));
router.use('/api/v1', require('./reviews'));

router.use('/api/products', require('./market'));
router.use('/api/subscriptions', require('./subscriptions').router);
router.use('/api/bundles', require('./bundles'));
router.use('/federation', require('./federation'));

router.get('/.well-known/stellar.toml', (req, res) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
  const passphrase = process.env.STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(`FEDERATION_SERVER="${backendUrl}/federation"\nNETWORK_PASSPHRASE="${passphrase}"\n`);
});

module.exports = router;
