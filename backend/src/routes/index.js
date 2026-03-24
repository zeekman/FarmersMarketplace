const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const authLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts, try again later' } });
const orderLimiter = rateLimit({ windowMs: 60 * 1000,       max: 10, message: { error: 'Too many orders, slow down' } });
const fundLimiter  = rateLimit({ windowMs: 60 * 60 * 1000,  max: 5,  message: { error: 'Funding limit reached, try again in an hour' } });

router.use('/api/auth/login',    authLimiter);
router.use('/api/auth/register', authLimiter);
router.use('/api/orders',        orderLimiter);
router.use('/api/wallet/fund',   fundLimiter);

router.use('/api/auth',     require('./auth'));
router.use('/api/products', require('./products'));
router.use('/api/orders',   require('./orders'));
router.use('/api/wallet',   require('./wallet'));

router.get('/api/health', (_, res) => res.json({ status: 'ok' }));

module.exports = router;
