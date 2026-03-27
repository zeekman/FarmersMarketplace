require('dotenv').config();

// Fail fast — refuse to start if critical secrets are missing
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

const app = express();

// HTTPS enforcement — must be first
app.use(enforceHttps);
app.use(hsts);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Serve uploaded product images as static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Expose CSRF token endpoint (must be before csrfProtect so it's never blocked)
app.get('/api/csrf-token', csrfTokenHandler);

// Apply CSRF protection to all state-changing routes
app.use(csrfProtect);

app.use(require('./routes'));
app.use(errorHandler);

module.exports = app;
