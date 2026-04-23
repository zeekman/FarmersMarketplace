require('dotenv').config();

const logger = require('./logger');
const REQUIRED_ENV = ['JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  logger.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
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
const { errorHandler } = require('./middleware/error');
const { sanitizeResponse } = require('./middleware/sanitize');
const requestLogger = require('./middleware/requestLogger');

const app = express();

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

const corsOrigins =
  process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const allowedOrigins = corsOrigins.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(sanitizeResponse);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads/videos', express.static(path.join(__dirname, '../uploads/videos')));

app.get('/api/csrf-token', csrfTokenHandler);

// Interactive API documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Apply CSRF protection to all state-changing routes (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(csrfProtect);
}

app.use(require('./routes'));
app.use(errorHandler);

// Start background jobs (skip in test to avoid open handles)
if (process.env.NODE_ENV !== 'test') {
  const { startActivityMonitor } = require('./jobs/activityMonitor');
  startActivityMonitor();
}

module.exports = app;
