require('dotenv').config();
// Express 4 does not forward rejected async route promises by itself.
require('express-async-errors');

const logger = require('./logger');
const REQUIRED_ENV = ['JWT_SECRET', 'ENCRYPTION_SECRET'];
const requiredEnv = process.env.NODE_ENV === 'production'
  ? [...REQUIRED_ENV, 'OBJECT_STORAGE_BUCKET']
  : REQUIRED_ENV;
const missing = requiredEnv.filter((k) => !process.env[k]);
const weakJwtSecret =
  process.env.NODE_ENV === 'production' &&
  Buffer.byteLength(process.env.JWT_SECRET || '', 'utf8') < 32;
if (missing.length || weakJwtSecret) {
  logger.error(
    `[FATAL] ${missing.length
      ? `Missing required environment variables: ${missing.join(', ')}`
      : 'JWT_SECRET must be at least 32 bytes in production'}`
  );
  logger.error('Copy backend/.env.example to backend/.env and fill in the values.');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const helmet = require('helmet');
const { enforceHttps, hsts } = require('./middleware/https');
const { csrfProtect, csrfTokenHandler } = require('./middleware/csrf');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { sanitizeResponse } = require('./middleware/sanitize');
const requestLogger = require('./middleware/requestLogger');
const auth = require('./middleware/auth');
const requireAdmin = require('./middleware/requireAdmin');
const categoriesRouter = require('./routes/categories');
const healthRouter = require('./routes/health');
const db = require('./db/schema');

const app = express();

// Health checks (liveness, readiness, detailed) must not be blocked by db.ready migrations
app.use(healthRouter);
let inflightRequests = 0;
let drainWaiters = [];
app.locals.isDraining = false;
app.locals.waitForInflight = () => inflightRequests === 0
  ? Promise.resolve()
  : new Promise((resolve) => drainWaiters.push(resolve));

app.use((req, res, next) => {
  if (app.locals.isDraining) return res.status(503).set('Connection', 'close').json({ success: false, error: 'server_shutting_down' });
  inflightRequests += 1;
  let completed = false;
  const done = () => {
    if (completed) return;
    completed = true;
    if (inflightRequests > 0) inflightRequests -= 1;
    if (inflightRequests === 0) {
      const waiters = drainWaiters;
      drainWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  };
  res.once('finish', done);
  res.once('close', done);
  next();
});

app.use((req, res, next) => {
  Promise.resolve(db.ready).then(() => next(), next);
});

// Configure proxy trust based on environment
// In production, set TRUST_PROXY to the number of proxies or 'true' for all
const trustProxy = process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? 1 : false);
if (trustProxy) {
  app.set('trust proxy', trustProxy);
}

app.use(requestLogger);
app.use(enforceHttps);
app.use(hsts);

// Configure Helmet with CSP to allow Stellar explorer links
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://stellar.expert", "https://horizon-testnet.stellar.org", "https://horizon.stellar.org"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

const corsOrigins = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const allowedOrigins = corsOrigins.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      const msg = `CORS origin not allowed: ${origin}`;
      if (process.env.NODE_ENV === 'production') {
        logger.warn(msg);
        return callback(new Error('Not allowed by CORS'));
      }
      // In non-production environments, log and allow for developer convenience
      logger.debug(msg);
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(sanitizeResponse);

// #1360: Serve uploaded files with hardened headers so a stored file can never
// be interpreted as active content (HTML/SVG) on the API origin. The restrictive
// CSP, nosniff and inline Content-Disposition with a safe filename neutralise
// stored-XSS attempts even if a malicious file slips through validation.
const uploadStaticOptions = {
  index: false,
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; media-src 'self'"
    );
    const safeName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  },
};
if (process.env.NODE_ENV !== 'production') {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads'), uploadStaticOptions));
  app.use('/uploads/videos', express.static(path.join(__dirname, '../uploads/videos'), uploadStaticOptions));
}

app.get('/api/csrf-token', csrfTokenHandler);
app.get('/api/v1/csrf-token', csrfTokenHandler);
// #836: Also expose at /api/auth/csrf-token for SPA initialization (duplicated for discoverability).
app.get('/api/auth/csrf-token', csrfTokenHandler);
// #1357: categories is mounted only through registerRoute in ./routes so it
// goes through the same rate limiter and CSRF ordering as every other router.

// Interactive API documentation
const enableApiDocs = process.env.ENABLE_API_DOCS === 'true' || 
  (process.env.NODE_ENV !== 'production' && process.env.ENABLE_API_DOCS !== 'false');

if (enableApiDocs) {
  // Relax CSP for Swagger UI as it needs inline scripts and styles
  app.use('/api/docs', (req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    );
    next();
  }, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Optionally expose Swagger spec as JSON behind admin auth in production
app.get('/api/docs.json', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return auth(req, res, () => requireAdmin(req, res, next));
  }
  next();
}, (req, res) => {
  res.json(swaggerSpec);
});

// Apply CSRF protection to all state-changing routes (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(csrfProtect);
}

app.use(require('./routes'));
app.use(notFoundHandler);
app.use(errorHandler);

// Background jobs are scheduled only by jobs/index.js (called from src/index.js),
// never on import and never outside the registry — #011/#1367.

module.exports = app;
