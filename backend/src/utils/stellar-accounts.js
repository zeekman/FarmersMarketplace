const config = require('../config');
const bip39 = require('bip39');
const StellarHDWallet = require('stellar-hd-wallet');
const { StellarSdk, isTestnet, server, networkPassphrase } = require('./stellar-config');

// In-memory cache: publicKey -> { federationAddress, expiresAt }
const _federationCache = new Map();
const FEDERATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * @returns {{ publicKey: string, secretKey: string }}
 */
function createWallet() {
  const keypair = StellarSdk.Keypair.random();
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Generates a fresh 24-word BIP-39 mnemonic and derives the first Stellar keypair.
 * @returns {{ mnemonic: string, publicKey: string, secretKey: string }}
 */
function createWalletFromMnemonic() {
  const mnemonic = bip39.generateMnemonic(256); // 24-word phrase
  const wallet = StellarHDWallet.fromMnemonic(mnemonic);
  const keypair = StellarSdk.Keypair.fromSecret(wallet.getSecret(0));
  return { mnemonic, publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Re-derives the Stellar keypair (account index 0) from an existing BIP-39 mnemonic.
 * @param {string} mnemonic
 * @returns {{ publicKey: string, secretKey: string }}
 */
function deriveKeypairFromMnemonic(mnemonic) {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic phrase');
  const wallet = StellarHDWallet.fromMnemonic(mnemonic);
  const keypair = StellarSdk.Keypair.fromSecret(wallet.getSecret(0));
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

async function fundTestnetAccount(publicKey) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  return response.json();
}

/**
 * Returns the native XLM balance of an account, or 0 if the account does not exist.
 * @param {string} publicKey
 * @returns {Promise<number>}
 */
async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === 'native');
    return xlm ? parseFloat(xlm.balance) : 0;
  } catch {
    return 0;
  }
}

/**
 * Returns all asset balances for an account, or [] if the account does not exist.
 * @param {string} publicKey
 * @returns {Promise<Array<{asset_type:string, asset_code:string, asset_issuer:string|null, balance:number, limit:number|null}>>}
 */
async function getAllBalances(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.map((b) => ({
      asset_type: b.asset_type,
      asset_code: b.asset_type === 'native' ? 'XLM' : b.asset_code,
      asset_issuer: b.asset_type === 'native' ? null : b.asset_issuer,
      balance: parseFloat(b.balance),
      limit: b.limit ? parseFloat(b.limit) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Adds a trustline for a non-native asset, enabling the account to hold it.
 * @param {{ secret: string, assetCode: string, assetIssuer: string }} params
 * @returns {Promise<string>} Transaction hash
 */
async function addTrustline({ secret, assetCode, assetIssuer }) {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const account = await server.loadAccount(keypair.publicKey());
  const asset = new StellarSdk.Asset(assetCode, assetIssuer);
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.changeTrust({ asset }))
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Removes a trustline (sets limit to 0). Throws with code `non_zero_balance` if the account still holds the asset.
 * @param {{ secret: string, assetCode: string, assetIssuer: string }} params
 * @returns {Promise<string>} Transaction hash
 */
async function removeTrustline({ secret, assetCode, assetIssuer }) {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const account = await server.loadAccount(keypair.publicKey());
  const asset = new StellarSdk.Asset(assetCode, assetIssuer);
  const existing = account.balances.find(
    (b) => b.asset_code === assetCode && b.asset_issuer === assetIssuer
  );
  if (existing && parseFloat(existing.balance) > 0) {
    const e = new Error('Cannot remove trustline with non-zero balance');
    e.code = 'non_zero_balance';
    throw e;
  }
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.changeTrust({ asset, limit: '0' }))
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Merges the source account into the destination, transferring all remaining XLM.
 * Throws with code `destination_not_found` if the destination account is not on the ledger.
 * @param {{ sourceSecret: string, destinationPublicKey: string }} params
 * @returns {Promise<string>} Transaction hash
 */
async function mergeAccount({ sourceSecret, destinationPublicKey }) {
  const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
  try {
    await server.loadAccount(destinationPublicKey);
  } catch (e) {
    if (e.response && e.response.status === 404) {
      const err = new Error('Destination account does not exist on the ledger');
      err.code = 'destination_not_found';
      throw err;
    }
    throw e;
  }
  const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(sourceAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.accountMerge({ destination: destinationPublicKey }))
    .setTimeout(30)
    .build();
  tx.sign(sourceKeypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Resolves a Stellar public key to its federation address (e.g. `alice*farmersmarket.io`).
 * Results are cached in memory for 10 minutes. Returns null if not registered.
 * @param {string} publicKey
 * @returns {Promise<string|null>}
 */
async function lookupFederationAddress(publicKey) {
  if (!publicKey) return null;
  const cached = _federationCache.get(publicKey);
  if (cached && Date.now() < cached.expiresAt) return cached.federationAddress;
  try {
    const record = await StellarSdk.FederationServer.resolve(publicKey);
    const federationAddress = record.stellar_address || null;
    _federationCache.set(publicKey, { federationAddress, expiresAt: Date.now() + FEDERATION_TTL_MS });
    return federationAddress;
  } catch {
    _federationCache.set(publicKey, { federationAddress: null, expiresAt: Date.now() + FEDERATION_TTL_MS });
    return null;
  }
}

class FederationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FederationError';
    this.code = code;
  }
}

// Cache for resolved federation addresses: address -> { publicKey, memo, expiresAt }
const _resolveCache = new Map();
const RESOLVE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolves a federation address (e.g. `alice*farmersmarket.io`) to a Stellar public key.
 * If the address has no `*`, it is returned as-is (assumed to already be a public key).
 * Local domain addresses are resolved against the `users` table; others via the Stellar Federation protocol.
 * @param {string} address
 * @param {object} db  better-sqlite3 database instance
 * @returns {Promise<{ publicKey: string, memo: string|null }>}
 */
async function resolveFederationAddress(address, db) {
  if (!address || !address.includes('*')) return { publicKey: address, memo: null };

  const cached = _resolveCache.get(address);
  if (cached && Date.now() < cached.expiresAt) return { publicKey: cached.publicKey, memo: cached.memo };

  const [username, domain] = address.split('*');
  const rawLocal = (config.federationDomain || config.frontendUrl || 'localhost')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split(':')[0];

  let publicKey, memo = null;

  if (domain === rawLocal || domain === 'localhost') {
    const user = db
      .prepare('SELECT stellar_public_key FROM users WHERE federation_name = ?')
      .get(username.toLowerCase());
    if (!user || !user.stellar_public_key)
      throw new FederationError(`Federation address not found: ${address}`, 'federation_unreachable');
    publicKey = user.stellar_public_key;
  } else {
    let record;
    try {
      record = await StellarSdk.Federation.Server.resolve(address);
    } catch (e) {
      throw new FederationError(`Could not reach federation server for "${address}": ${e.message}`, 'federation_unreachable');
    }
    if (!record.account_id) throw new FederationError('No account_id in federation response', 'federation_unreachable');
    publicKey = record.account_id;
    memo = record.memo || null;
  }

  if (!StellarSdk.StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new FederationError(`Resolved address is not a valid Stellar public key: ${publicKey}`, 'invalid_resolved_address');
  }

  _resolveCache.set(address, { publicKey, memo, expiresAt: Date.now() + RESOLVE_TTL_MS });
  return { publicKey, memo };
}

module.exports = {
  FederationError,
  createWallet,
  createWalletFromMnemonic,
  deriveKeypairFromMnemonic,
  fundTestnetAccount,
  getBalance,
  getAllBalances,
  addTrustline,
  removeTrustline,
  mergeAccount,
  lookupFederationAddress,
  resolveFederationAddress,
};
