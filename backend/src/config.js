require('dotenv').config();
const { z, ZodError } = require('zod');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Auth — required
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  REFRESH_TOKEN_SECRET: z.string().optional(),

  // Stellar
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  STELLAR_MAINNET_CONFIRMED: z.string().optional(),
  STELLAR_HORIZON_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),

  // Database / cache
  DATABASE_URL: z.string().optional(),
  DB_QUERY_TIMEOUT_SQLITE: z.coerce.number().int().positive().default(5000),
  DB_QUERY_TIMEOUT_POSTGRES: z.coerce.number().int().positive().default(10000),
  REDIS_URL: z.string().optional(),

  // Origins / CORS
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  BACKEND_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGIN: z.string().optional(),
  FEDERATION_DOMAIN: z.string().default('farmersmarket.io'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Encryption (cooperatives)
  ENCRYPTION_SECRET: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().positive().default(100),

  // Platform fee
  PLATFORM_FEE_PERCENT: z.coerce.number().nonnegative().optional(),
  PLATFORM_WALLET_PUBLIC_KEY: z.string().optional(),
  PLATFORM_FEE_ACCOUNT_SECRET: z.string().optional(),
  FEE_BUMP_THRESHOLD_XLM: z.coerce.number().positive().optional(),

  // Orders
  MAX_ORDER_QUANTITY: z.coerce.number().int().positive().default(10000),

  // Soroban
  SOROBAN_RPC_URL: z.string().optional(),
  SOROBAN_ESCROW_CONTRACT_ID: z.string().optional(),
  SOROBAN_XLM_TOKEN_CONTRACT_ID: z.string().optional(),
  SOROBAN_SIMULATION_SOURCE_PUBLIC_KEY: z.string().optional(),
  SOROBAN_ESCROW_TIMEOUT_DAYS: z.coerce.number().int().positive().default(14),

  // Reward token contract
  REWARD_TOKEN_CONTRACT_ID: z.string().optional(),
  REWARD_TOKEN_ADMIN_SECRET: z.string().optional(),

  // DEX / order book
  USDC_ISSUER: z.string().default('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'),

  // Web Push
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_VAPID_SUBJECT: z.string().default('mailto:admin@farmersmarketplace.com'),

  // Proxy
  TRUST_PROXY: z.string().optional(),

  // Geo API
  GEO_API_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

  // Freshness alerts
  FRESHNESS_ALERT_DAYS: z.coerce.number().int().positive().default(3),
});

let env;
try {
  env = EnvSchema.parse(process.env);
} catch (err) {
  if (err instanceof ZodError) {
    console.error('[config] Invalid or missing environment variables:');
    err.errors.forEach(e => {
      console.error(`  ${e.path.join('.') || '(root)'}: ${e.message}`);
    });
    console.error('[config] Copy backend/.env.example to backend/.env and fill in the required values.');
    process.exit(1);
  }
  throw err;
}

const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  jwtSecret: env.JWT_SECRET,
  refreshTokenSecret: env.REFRESH_TOKEN_SECRET || env.JWT_SECRET,

  // Stellar / Soroban
  stellarNetwork: env.STELLAR_NETWORK,
  stellarHorizonUrl: env.STELLAR_HORIZON_URL || null,
  platformFeePercent: env.PLATFORM_FEE_PERCENT ?? 0,
  platformWalletPublicKey: env.PLATFORM_WALLET_PUBLIC_KEY || null,
  platformFeeAccountSecret: env.PLATFORM_FEE_ACCOUNT_SECRET || null,
  feeBumpThresholdXlm: env.FEE_BUMP_THRESHOLD_XLM ?? 2,
  sorobanEscrowContractId: env.SOROBAN_ESCROW_CONTRACT_ID || null,
  sorobanXlmTokenContractId: env.SOROBAN_XLM_TOKEN_CONTRACT_ID || null,
  sorobanSimulationSourcePublicKey: env.SOROBAN_SIMULATION_SOURCE_PUBLIC_KEY || null,
  sorobanEscrowTimeoutDays: env.SOROBAN_ESCROW_TIMEOUT_DAYS,
  rewardTokenContractId: env.REWARD_TOKEN_CONTRACT_ID || null,
  rewardTokenAdminSecret: env.REWARD_TOKEN_ADMIN_SECRET || null,
  usdcIssuer: env.USDC_ISSUER,

  // Origins / federation
  clientOrigin: env.CLIENT_ORIGIN,
  corsOrigin: env.CORS_ORIGIN || env.FRONTEND_ORIGIN,
  frontendUrl: env.FRONTEND_URL,
  federationDomain: env.FEDERATION_DOMAIN,

  // Database / cache
  databaseUrl: env.DATABASE_URL || null,
  redisUrl: env.REDIS_URL || null,
  GEO_API_TIMEOUT_MS: env.GEO_API_TIMEOUT_MS,
  freshnessAlertDays: env.FRESHNESS_ALERT_DAYS,
};

module.exports = config;
