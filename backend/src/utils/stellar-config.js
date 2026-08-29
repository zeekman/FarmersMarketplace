// Shared Stellar network configuration for account/key-derivation utilities.
// Kept separate from stellar.js so key-management code (stellar-accounts.js)
// does not need to pull in the full payments/escrow module surface.
const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('../logger');

const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();

if (!['testnet', 'mainnet'].includes(STELLAR_NETWORK)) {
  throw new Error(`Invalid STELLAR_NETWORK "${STELLAR_NETWORK}". Must be "testnet" or "mainnet".`);
}

const isTestnet = STELLAR_NETWORK === 'testnet';

const horizonUrl =
  process.env.STELLAR_HORIZON_URL ||
  (isTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
if (STELLAR_NETWORK === 'mainnet' && process.env.STELLAR_MAINNET_CONFIRMED !== 'true') {
  throw new Error(
    'Mainnet use requires STELLAR_MAINNET_CONFIRMED=true in your environment. ' +
      'This guard prevents accidental real-fund transactions.'
  );
}

const isTestnet = STELLAR_NETWORK === 'testnet';

const sorobanRpcUrl =
  process.env.SOROBAN_RPC_URL ||
  (isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org');

const networkPassphrase = isTestnet ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
const server = new StellarSdk.Horizon.Server(horizonUrl);

module.exports = {
  StellarSdk,
  STELLAR_NETWORK,
  isTestnet,
  horizonUrl,
  sorobanRpcUrl,
  networkPassphrase,
  server,
const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);

const horizonUrl =
  process.env.STELLAR_HORIZON_URL ||
  (isTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');

const server = new StellarSdk.Horizon.Server(horizonUrl);
const networkPassphrase = isTestnet ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;

// Required Soroban/escrow environment variables. Missing values cause cryptic
// runtime failures at the contract call site, so we validate them at startup.
// Variable names match backend/src/config.js (the typed config layer).
const REQUIRED_STELLAR_VARS = [
  'SOROBAN_RPC_URL',
  'SOROBAN_ESCROW_CONTRACT_ID',
  'SOROBAN_XLM_TOKEN_CONTRACT_ID',
];

// Optional variables: a warning is logged but startup is not blocked.
const OPTIONAL_STELLAR_VARS = ['REWARD_TOKEN_CONTRACT_ID', 'REWARD_TOKEN_ADMIN_SECRET'];

/**
 * Validate that all required Stellar/Soroban environment variables are present.
 *
 * Throws a single descriptive error listing every missing required variable so
 * misconfiguration is caught at startup instead of at the contract call site.
 * Optional variables only log a warning. The detected network (testnet/mainnet)
 * is reported so passphrase/network mismatches are obvious early.
 *
 * Note: SOROBAN_RPC_URL has a network-derived default, so it is only reported as
 * missing when no value (explicit or default) is available.
 *
 * @returns {{ network: string, networkPassphrase: string }}
 */
function validateStellarConfig() {
  const network = isTestnet ? 'testnet' : 'mainnet';
  logger.info(`[stellar-config] Validating Stellar config for ${network} (${networkPassphrase})`);

  const resolved = {
    SOROBAN_RPC_URL: sorobanRpcUrl, // always set (falls back to a network default)
    SOROBAN_ESCROW_CONTRACT_ID: process.env.SOROBAN_ESCROW_CONTRACT_ID,
    SOROBAN_XLM_TOKEN_CONTRACT_ID: process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID,
  };

  const missing = REQUIRED_STELLAR_VARS.filter((name) => !resolved[name]);
  if (missing.length > 0) {
    throw new Error(
      `[stellar-config] Missing required Stellar/Soroban environment variable(s): ${missing.join(', ')}. ` +
        `Detected network: ${network}. Copy backend/.env.example to backend/.env and set these values.`
    );
  }

  for (const name of OPTIONAL_STELLAR_VARS) {
    if (!process.env[name]) {
      logger.warn(`[stellar-config] Optional variable ${name} is not set; related features are disabled.`);
    }
  }

  return { network, networkPassphrase };
}

module.exports = {
  StellarSdk,
  isTestnet,
  server,
  sorobanServer,
  networkPassphrase,
  validateStellarConfig,
};
