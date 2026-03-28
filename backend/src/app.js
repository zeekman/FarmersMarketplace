require('dotenv').config();

const REQUIRED_ENV = ['JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy backend/.env.example to backend/.env and fill in the values.');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { enforceHttps, hsts } = require('./middleware/https');
const { csrfProtect, csrfTokenHandler } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/error');
const { sanitizeResponse } = require('./middleware/sanitize');

const app = express();

app.use(enforceHttps);
app.use(hsts);

const corsOrigins = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const allowedOrigins = corsOrigins.split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(sanitizeResponse);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/csrf-token', csrfTokenHandler);

if (process.env.NODE_ENV !== 'test') {
  app.use(csrfProtect);
}

app.use(require('./routes'));
app.use(errorHandler);

module.exports = app;
