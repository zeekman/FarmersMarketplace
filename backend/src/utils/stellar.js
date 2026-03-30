const StellarSdk = require('@stellar/stellar-sdk');
const bip39 = require('bip39');
const StellarHDWallet = require('stellar-hd-wallet');

const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();

if (!['testnet', 'mainnet'].includes(STELLAR_NETWORK)) {
  throw new Error(`Invalid STELLAR_NETWORK "${STELLAR_NETWORK}". Must be "testnet" or "mainnet".`);
}

if (STELLAR_NETWORK === 'mainnet' && process.env.STELLAR_MAINNET_CONFIRMED !== 'true') {
  throw new Error(
    'Mainnet use requires STELLAR_MAINNET_CONFIRMED=true in your environment. ' +
      'This guard prevents accidental real-fund transactions.'
  );
}

const isTestnet = STELLAR_NETWORK === 'testnet';

const horizonUrl =
  process.env.STELLAR_HORIZON_URL ||
  (isTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');

const server = new StellarSdk.Horizon.Server(horizonUrl);
const networkPassphrase = isTestnet ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;

function createWallet() {
  const keypair = StellarSdk.Keypair.random();
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Generate a BIP39 mnemonic and derive a Stellar keypair from it.
 * Returns { mnemonic, publicKey, secretKey }
 */
function createWalletFromMnemonic() {
  const mnemonic = bip39.generateMnemonic(256); // 24-word phrase
  const wallet = StellarHDWallet.fromMnemonic(mnemonic);
  const keypair = StellarSdk.Keypair.fromSecret(wallet.getSecret(0));
  return {
    mnemonic,
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
}

/**
 * Derive a Stellar keypair from an existing BIP39 mnemonic.
 * Returns { publicKey, secretKey }
 */
function deriveKeypairFromMnemonic(mnemonic) {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }
  const wallet = StellarHDWallet.fromMnemonic(mnemonic);
  const keypair = StellarSdk.Keypair.fromSecret(wallet.getSecret(0));
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

async function fundTestnetAccount(publicKey) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  return response.json();
}

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
 * Wrap an inner transaction with a FeeBumpTransaction so the platform account
 * pays the network fee instead of the buyer.
 * Returns the fee-bumped transaction (signed by the fee account).
 */
async function wrapWithFeeBump(innerTx, feeAccountSecret) {
  const feeKeypair = StellarSdk.Keypair.fromSecret(feeAccountSecret);
  const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    feeKeypair,
    StellarSdk.BASE_FEE * 10, // fee bump pays 10x base fee
    innerTx,
    networkPassphrase
  );
  feeBumpTx.sign(feeKeypair);
  return feeBumpTx;
}

const FEE_BUMP_THRESHOLD_XLM = parseFloat(process.env.FEE_BUMP_THRESHOLD_XLM || '2');

async function sendPayment({ senderSecret, receiverPublicKey, amount, memo }) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);

  let senderAccount;
  try {
    senderAccount = await server.loadAccount(senderKeypair.publicKey());
  } catch (error) {
    if (error.response && error.response.status === 404) {
      const err = new Error('Stellar account not found. Please fund your wallet to activate it.');
      err.code = 'account_not_found';
      throw err;
    }
    throw error;
  }

  const feePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || '0');
  const platformWallet = process.env.PLATFORM_WALLET_PUBLIC_KEY;

  const farmerAmount =
    feePercent > 0 && platformWallet
      ? parseFloat((amount * (1 - feePercent / 100)).toFixed(7))
      : amount;
  const feeAmount =
    feePercent > 0 && platformWallet ? parseFloat((amount * (feePercent / 100)).toFixed(7)) : 0;

  const txBuilder = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: receiverPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: farmerAmount.toFixed(7),
      })
    )
    .addMemo(StellarSdk.Memo.text(memo || 'FarmersMarket'))
    .setTimeout(30);

  if (feeAmount > 0 && platformWallet) {
    txBuilder.addOperation(
      StellarSdk.Operation.payment({
        destination: platformWallet,
        asset: StellarSdk.Asset.native(),
        amount: feeAmount.toFixed(7),
      })
    );
  }

  const transaction = txBuilder.build();
  transaction.sign(senderKeypair);

  // Check if buyer balance is below threshold — wrap with fee bump if so
  const feeAccountSecret = process.env.PLATFORM_FEE_ACCOUNT_SECRET;
  const buyerBalance = await getBalance(senderKeypair.publicKey());
  const usedFeeBump = feeAccountSecret && buyerBalance < FEE_BUMP_THRESHOLD_XLM;

  let txToSubmit = transaction;
  if (usedFeeBump) {
    console.log(
      `[FeeBump] Buyer balance ${buyerBalance} XLM < threshold ${FEE_BUMP_THRESHOLD_XLM} XLM — wrapping with fee bump`
    );
    txToSubmit = await wrapWithFeeBump(transaction, feeAccountSecret);
  }

  const result = await server.submitTransaction(txToSubmit);

  if (usedFeeBump) {
    console.log(
      `[FeeBump] Fee bump used for tx ${result.hash} — buyer: ${senderKeypair.publicKey()}`
    );
  }

  return result.hash;
}

async function getTransactions(publicKey) {
  try {
    const payments = await server.payments().forAccount(publicKey).order('desc').limit(20).call();

    return payments.records
      .filter((p) => p.type === 'payment' && p.asset_type === 'native')
      .map((p) => ({
        id: p.id,
        type: p.from === publicKey ? 'sent' : 'received',
        amount: p.amount,
        from: p.from,
        to: p.to,
        created_at: p.created_at,
        transaction_hash: p.transaction_hash,
      }));
  } catch {
    return [];
  }
}

module.exports = {
  isTestnet,
  server,
  createWallet,
  fundTestnetAccount,
  getBalance,
  sendPayment,
  getTransactions,
};
// In-memory cache: publicKey -> { federationAddress, expiresAt }
const _federationCache = new Map();
const FEDERATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Reverse-resolve a Stellar public key to a federation address (e.g. "alice*stellar.org").
 * Returns null if not found or on any error. Results are cached for 10 minutes.
 */
async function lookupFederationAddress(publicKey) {
  if (!publicKey) return null;
  const cached = _federationCache.get(publicKey);
  if (cached && Date.now() < cached.expiresAt) return cached.federationAddress;

  try {
    const record = await StellarSdk.FederationServer.resolve(publicKey);
    const federationAddress = record.stellar_address || null;
    _federationCache.set(publicKey, {
      federationAddress,
      expiresAt: Date.now() + FEDERATION_TTL_MS,
    });
    return federationAddress;
  } catch {
    // Cache null result to avoid hammering on repeated failures
    _federationCache.set(publicKey, {
      federationAddress: null,
      expiresAt: Date.now() + FEDERATION_TTL_MS,
    });
    return null;
  }
}

module.exports = {
  isTestnet,
  server,
  createWallet,
  fundTestnetAccount,
  getBalance,
  sendPayment,
  getTransactions,
};
async function createClaimableBalance({ senderSecret, farmerPublicKey, buyerPublicKey, amount }) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());

  const farmerClaimant = new StellarSdk.Claimant(
    farmerPublicKey,
    StellarSdk.Claimant.predicateUnconditional()
  );
  const buyerClaimant = new StellarSdk.Claimant(
    buyerPublicKey,
    StellarSdk.Claimant.predicateNot(StellarSdk.Claimant.predicateBeforeRelativeTime('1209600'))
  );

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.createClaimableBalance({
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
        claimants: [farmerClaimant, buyerClaimant],
      })
    )
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);

  const claimableBalances = await server
    .claimableBalances()
    .claimant(farmerPublicKey)
    .order('desc')
    .limit(5)
    .call();

  const balance = claimableBalances.records.find(
    (b) =>
      b.amount === amount.toFixed(7) && b.claimants.some((c) => c.destination === buyerPublicKey)
  );
  if (!balance) throw new Error('Claimable balance not found after creation');

  return { txHash: result.hash, balanceId: balance.id };
}

async function claimBalance({ claimantSecret, balanceId }) {
  const claimantKeypair = StellarSdk.Keypair.fromSecret(claimantSecret);
  const claimantAccount = await server.loadAccount(claimantKeypair.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(claimantAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceID: balanceId }))
    .setTimeout(30)
    .build();

  transaction.sign(claimantKeypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

async function createPreorderClaimableBalance({
  senderSecret,
  farmerPublicKey,
  amount,
  unlockAtUnix,
}) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());

  const farmerClaimant = new StellarSdk.Claimant(
    farmerPublicKey,
    StellarSdk.Claimant.predicateNot(
      StellarSdk.Claimant.predicateBeforeAbsoluteTime(String(unlockAtUnix))
    )
  );

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.createClaimableBalance({
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
        claimants: [farmerClaimant],
      })
    )
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);

  const claimableBalances = await server
    .claimableBalances()
    .claimant(farmerPublicKey)
    .order('desc')
    .limit(5)
    .call();

  const balance = claimableBalances.records.find((b) => b.amount === amount.toFixed(7));
  if (!balance) throw new Error('Claimable balance not found after creation');

  return { txHash: result.hash, balanceId: balance.id };
}

async function getContractState(contractId, prefix = null) {
  const sorobanRpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org');
  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);

  // Build a ledger key for the contract's data entries
  const contractAddress = new StellarSdk.Address(contractId);
  const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
    })
  );

  let response;
  try {
    response = await sorobanServer.getLedgerEntries(ledgerKey);
  } catch (e) {
    if (e.message?.includes('not found') || e.code === 404) {
      const notFound = new Error('Contract not found');
      notFound.code = 404;
      throw notFound;
    }
    throw e;
  }

  const entries = (response.entries || [])
    .map((entry) => {
      const data = entry.val?.contractData?.();
      const key = data ? StellarSdk.scValToNative(data.key()) : String(entry.key);
      const val = data ? StellarSdk.scValToNative(data.val()) : null;
      const durability = data?.durability()?.name || 'Persistent';
      return { key: String(key), val, durability };
    })
    .filter((e) => !prefix || String(e.key).startsWith(prefix));

  return entries;
}

async function invokeEscrowContract({
  action,
  senderSecret,
  orderId,
  buyerPublicKey,
  farmerPublicKey,
  amount,
  timeoutUnix,
}) {
  const contractId = process.env.SOROBAN_ESCROW_CONTRACT_ID;
  const xlmTokenContractId = process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID;
  if (!contractId) {
    throw new Error('SOROBAN_ESCROW_CONTRACT_ID is not configured');
  }
  if (!xlmTokenContractId) {
    throw new Error('SOROBAN_XLM_TOKEN_CONTRACT_ID is not configured');
  }

  const keypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const source = await server.loadAccount(keypair.publicKey());
  const sorobanRpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org');
  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);
  const contract = new StellarSdk.Contract(contractId);

  let operation;
  if (action === 'deposit') {
    const amountStroops = BigInt(Math.round(Number(amount) * 10_000_000));
    operation = contract.call(
      'deposit',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' }),
      StellarSdk.nativeToScVal(buyerPublicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(farmerPublicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(Number(timeoutUnix), { type: 'u64' })
    );
  } else if (action === 'release') {
    operation = contract.call(
      'release',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' })
    );
  } else if (action === 'refund') {
    operation = contract.call(
      'refund',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' })
    );
  } else if (action === 'dispute') {
    operation = contract.call(
      'dispute',
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' }),
      StellarSdk.nativeToScVal(keypair.publicKey(), { type: 'address' })
    );
  } else {
    throw new Error(`Unsupported Soroban escrow action: ${action}`);
  }

  let tx = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  tx = await sorobanServer.prepareTransaction(tx);
  tx.sign(keypair);

  const sendResult = await sorobanServer.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(sendResult.errorResultXdr || 'Soroban transaction submission failed');
  }

  const hash = sendResult.hash || tx.hash().toString('hex');
  for (let i = 0; i < 15; i += 1) {
    const txResult = await sorobanServer.getTransaction(hash);
    if (txResult.status === 'SUCCESS') {
      return { txHash: hash, contractId };
    }
    if (txResult.status === 'FAILED') {
      throw new Error('Soroban transaction failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Soroban transaction confirmation timed out');
}

// Resolve a federation address (e.g. farmer*farmersmarket.io) to a Stellar public key.
// Pass the db instance for local domain lookups.
async function resolveFederationAddress(address, db) {
  if (!address || !address.includes('*')) return address; // already a raw key

  const [username, domain] = address.split('*');
  const rawLocal = (process.env.FEDERATION_DOMAIN || process.env.FRONTEND_URL || 'localhost')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split(':')[0];

  if (domain === rawLocal || domain === 'localhost') {
    const user = db
      .prepare('SELECT stellar_public_key FROM users WHERE federation_name = ?')
      .get(username.toLowerCase());
    if (!user || !user.stellar_public_key)
      throw new Error(`Federation address not found: ${address}`);
    return user.stellar_public_key;
  }

  // External domain — use Stellar SDK federation resolution
  try {
    const record = await StellarSdk.Federation.Server.resolve(address);
    if (!record.account_id) throw new Error('No account_id in federation response');
    return record.account_id;
  } catch (e) {
    throw new Error(`Could not resolve federation address "${address}": ${e.message}`);
  }
}

// Mint reward tokens to a buyer after purchase
async function mintRewardTokens(buyerAddress, amount) {
  const contractId = process.env.REWARD_TOKEN_CONTRACT_ID;
  if (!contractId) {
    console.warn('[Stellar] REWARD_TOKEN_CONTRACT_ID not set, skipping reward mint');
    return null;
  }

  const adminSecret = process.env.REWARD_TOKEN_ADMIN_SECRET;
  if (!adminSecret) {
    console.warn('[Stellar] REWARD_TOKEN_ADMIN_SECRET not set, skipping reward mint');
    return null;
  }

  try {
    const adminKeypair = StellarSdk.Keypair.fromSecret(adminSecret);
    const adminAccount = await server.loadAccount(adminKeypair.publicKey());

    const contract = new StellarSdk.Contract(contractId);
    const transaction = new StellarSdk.TransactionBuilder(adminAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'mint',
          StellarSdk.nativeToScVal(buyerAddress, { type: 'address' }),
          StellarSdk.nativeToScVal(amount, { type: 'i128' })
        )
      )
      .setTimeout(30)
      .build();

    transaction.sign(adminKeypair);
    const result = await server.submitTransaction(transaction);
    return result.hash;
  } catch (error) {
    console.error('[Stellar] Failed to mint reward tokens:', error.message);
    return null;
  }
}

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

async function addTrustline({ secret, assetCode, assetIssuer }) {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const account = await server.loadAccount(keypair.publicKey());
  const asset = new StellarSdk.Asset(assetCode, assetIssuer);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

async function removeTrustline({ secret, assetCode, assetIssuer }) {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const account = await server.loadAccount(keypair.publicKey());
  const asset = new StellarSdk.Asset(assetCode, assetIssuer);

  // Check balance is zero before removing
  const existing = account.balances.find(
    (b) => b.asset_code === assetCode && b.asset_issuer === assetIssuer
  );
  if (existing && parseFloat(existing.balance) > 0) {
    const e = new Error('Cannot remove trustline with non-zero balance');
    e.code = 'non_zero_balance';
    throw e;
  }

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset, limit: '0' }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

function getPlatformFeeInfo(amount) {
  const feePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || '0');
  const platformWallet = process.env.PLATFORM_WALLET_PUBLIC_KEY || null;
  if (!feePercent || !platformWallet) {
    return {
      feePercent: 0,
      feeAmount: 0,
      farmerAmount: amount,
      platformWallet: null,
    };
  }
  const feeAmount = parseFloat(((amount * feePercent) / 100).toFixed(7));
  const farmerAmount = parseFloat((amount - feeAmount).toFixed(7));
  return { feePercent, feeAmount, farmerAmount, platformWallet };
}

/**
 * Find the best path and return the estimated source amount needed.
 * Uses Horizon's /paths/strict-send to find available paths.
 */
async function getPathPaymentEstimate({
  sourceAssetCode,
  sourceAssetIssuer,
  destPublicKey: _destPublicKey,
  destAmount,
}) {
  const sourceAsset =
    sourceAssetCode === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(sourceAssetCode, sourceAssetIssuer);

  const destAsset = StellarSdk.Asset.native();

  // Use strict-receive: find cheapest source amount to deliver destAmount XLM
  const paths = await server
    .strictReceivePaths(sourceAsset, destAsset, String(parseFloat(destAmount).toFixed(7)))
    .call();

  if (!paths.records || paths.records.length === 0) {
    const e = new Error(`No payment path found from ${sourceAssetCode} to XLM`);
    e.code = 'no_path';
    throw e;
  }

  const best = paths.records[0];
  return {
    sourceAmount: parseFloat(best.source_amount),
    path: best.path,
  };
}

/**
 * PathPaymentStrictReceive: buyer pays in sourceAsset, farmer receives exactly destAmount XLM.
 * sendMax is the maximum source asset the buyer is willing to spend (slippage guard).
 */
async function pathPayment({
  senderSecret,
  sourceAssetCode,
  sourceAssetIssuer,
  sendMax,
  receiverPublicKey,
  destAmount,
  memo,
}) {
  const keypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const account = await server.loadAccount(keypair.publicKey());

  const sourceAsset =
    sourceAssetCode === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(sourceAssetCode, sourceAssetIssuer);

  const destAsset = StellarSdk.Asset.native();

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.pathPaymentStrictReceive({
        sendAsset: sourceAsset,
        sendMax: parseFloat(sendMax).toFixed(7),
        destination: receiverPublicKey,
        destAsset,
        destAmount: parseFloat(destAmount).toFixed(7),
      })
    )
    .addMemo(StellarSdk.Memo.text(memo || 'FarmersMarket'))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Fetch and decode Soroban contract events via getEvents RPC.
 * @param {string} contractId - Contract address (base32 or hex)
 * @param {{ type?: string, from?: string, to?: string, page?: number, limit?: number }} filters
 */
async function getContractEvents(contractId, filters = {}) {
  const sorobanRpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (isTestnet
      ? "https://soroban-testnet.stellar.org"
      : "https://soroban.stellar.org");
  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);

  const { type, from, to, page = 1, limit = 20 } = filters;

  // Build ledger range from timestamps if provided
  const latestLedger = await sorobanServer.getLatestLedger();
  const startLedger = from
    ? Math.max(1, latestLedger.sequence - Math.ceil((Date.now() / 1000 - Math.floor(new Date(from).getTime() / 1000)) / 5))
    : Math.max(1, latestLedger.sequence - 17280); // ~1 day of ledgers

  const rpcFilters = [{ type: type || 'contract', contractIds: [contractId] }];

  const response = await sorobanServer.getEvents({
    startLedger,
    filters: rpcFilters,
    limit: 200, // fetch more, then filter/paginate in memory
  });

  let events = (response.events || []).map((ev) => {
    const topics = (ev.topic || []).map((t) => {
      try { return StellarSdk.scValToNative(t); } catch { return t.toXDR('base64'); }
    });
    let data = null;
    try { data = StellarSdk.scValToNative(ev.value); } catch { data = ev.value?.toXDR?.('base64') ?? null; }

    return {
      id: ev.id,
      ledger: ev.ledger,
      ledgerClosedAt: ev.ledgerClosedAt,
      type: ev.type,
      contractId: ev.contractId,
      topics,
      data,
    };
  });

  // Filter by date range
  if (from) events = events.filter((e) => new Date(e.ledgerClosedAt) >= new Date(from));
  if (to)   events = events.filter((e) => new Date(e.ledgerClosedAt) <= new Date(to));

  const total = events.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  const items = events.slice(offset, offset + limit);

  return { events: items, pagination: { page, pages, total, limit } };
}

module.exports = {
  isTestnet,
  server,
  createWallet,
  createWalletFromMnemonic,
  deriveKeypairFromMnemonic,
  fundTestnetAccount,
  getBalance,
  getAllBalances,
  sendPayment,
  wrapWithFeeBump,
  pathPayment,
  getPathPaymentEstimate,
  getPlatformFeeInfo,
  getTransactions,
  lookupFederationAddress,
  addTrustline,
  removeTrustline,
  createClaimableBalance,
  createPreorderClaimableBalance,
  claimBalance,
  invokeEscrowContract,
  getContractState,
  getContractEvents,
  resolveFederationAddress,
  mintRewardTokens,
};
