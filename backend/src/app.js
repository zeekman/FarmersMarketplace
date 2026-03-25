require('dotenv').config();

// Fail fast — refuse to start if critical secrets are missing
const REQUIRED_ENV = ['JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy backend/.env.example to backend/.env and fill in the values.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(require('./routes'));

module.exports = app;
