require('dotenv').config();

const REQUIRED = ['JWT_SECRET'];

const missing = REQUIRED.filter(key => !process.env[key] || process.env[key].trim() === '');

if (missing.length > 0) {
  console.error('[config] Missing required environment variables:');
  missing.forEach(key => console.error(`  - ${key}`));
  console.error('[config] Copy backend/.env.example to backend/.env and fill in the required values.');
  process.exit(1);
}

const config = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET,
  stellarNetwork: process.env.STELLAR_NETWORK || 'testnet',
  stellarHorizonUrl: process.env.STELLAR_HORIZON_URL || null,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  corsOrigin: process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || null,
  redisUrl: process.env.REDIS_URL || null,
};

module.exports = config;
