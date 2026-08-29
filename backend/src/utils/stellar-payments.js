const config = require('../config');
const { StellarSdk, isTestnet, server, networkPassphrase } = require('./stellar-config');
const { getBalance } = require('./stellar-accounts');
const logger = require('../logger');

async function wrapWithFeeBump(innerTx, feeAccountSecret) {
  const feeKeypair = StellarSdk.Keypair.fromSecret(feeAccountSecret);
  const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    feeKeypair,
    StellarSdk.BASE_FEE * 10,
    innerTx,
    networkPassphrase
  );
  feeBumpTx.sign(feeKeypair);
  return feeBumpTx;
}

/**
 * Sends XLM from one account to another, splitting off the platform fee when configured.
 * Wraps the transaction in a fee-bump if the sender's balance is below `FEE_BUMP_THRESHOLD_XLM`.
 * @param {{ senderSecret: string, receiverPublicKey: string, amount: number, memo?: string, requestId?: string }} params
 * @returns {Promise<string>} Transaction hash
 * @throws {{ code: 'account_not_found' }} if the sender account is not funded
 */
async function sendPayment({ senderSecret, receiverPublicKey, amount, memo, requestId }) {
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

  const feePercent = config.platformFeePercent;
  const platformWallet = config.platformWalletPublicKey;
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

  const feeAccountSecret = config.platformFeeAccountSecret;
  const buyerBalance = await getBalance(senderKeypair.publicKey());
  const usedFeeBump = feeAccountSecret && buyerBalance < config.feeBumpThresholdXlm;

  let txToSubmit = transaction;
  if (usedFeeBump) {
    txToSubmit = await wrapWithFeeBump(transaction, feeAccountSecret);
  }

  const result = await server.submitTransaction(txToSubmit);
  logger.info('stellar_payment_submitted', {
    requestId: requestId || null,
    txHash: result.hash,
    from: senderKeypair.publicKey(),
    to: receiverPublicKey,
    amount,
  });
  return result.hash;
}

/**
 * Fetches the native-XLM payment history for an account, newest first.
 * @param {string} publicKey
 * @param {{ cursor?: string, limit?: number }} [opts]
 * @returns {Promise<{ records: object[], next_cursor: string|null, prev_cursor: string|null }>}
 */
async function getTransactions(publicKey, { cursor, limit = 20 } = {}) {
  try {
    let call = server.payments().forAccount(publicKey).order('desc').limit(Math.min(limit, 200));
    if (cursor) call = call.cursor(cursor);
    const payments = await call.call();
    const records = payments.records
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
    const next_cursor = payments.records.length > 0
      ? payments.records[payments.records.length - 1].paging_token
      : null;
    const prev_cursor = payments.records.length > 0
      ? payments.records[0].paging_token
      : null;
    return { records, next_cursor, prev_cursor };
  } catch {
    return { records: [], next_cursor: null, prev_cursor: null };
  }
}

/**
 * Builds a `web+stellar:pay?…` URI for wallet deep-linking.
 * @param {{ destination: string, amount: number|string, assetCode: string, assetIssuer: string, memo?: string }} params
 * @returns {string}
 */
function generatePaymentLink({ destination, amount, assetCode, assetIssuer, memo }) {
  const params = new URLSearchParams({
    destination,
    amount,
    asset_code: assetCode,
    asset_issuer: assetIssuer,
    ...(memo ? { memo, memo_type: 'text' } : {}),
  });
  return `web+stellar:pay?${params.toString()}`;
}

/**
 * Computes the platform fee split for a given XLM amount.
 * Returns zero-fee info when `PLATFORM_FEE_PERCENT` or `PLATFORM_WALLET_PUBLIC_KEY` are not set.
 * @param {number} amount
 * @returns {{ feePercent: number, feeAmount: number, farmerAmount: number, platformWallet: string|null }}
 */
function getPlatformFeeInfo(amount) {
  const feePercent = config.platformFeePercent;
  const platformWallet = config.platformWalletPublicKey;
  if (!feePercent || !platformWallet) {
    return { feePercent: 0, feeAmount: 0, farmerAmount: amount, platformWallet: null };
  }
  const feeAmount = parseFloat(((amount * feePercent) / 100).toFixed(7));
  const farmerAmount = parseFloat((amount - feeAmount).toFixed(7));
  return { feePercent, feeAmount, farmerAmount, platformWallet };
}

function getPathPaymentSendMax(sourceAmount, slippagePercent = 0.5) {
  return parseFloat((sourceAmount * (1 + slippagePercent / 100)).toFixed(7));
}

/**
 * Queries Horizon for the best path to receive `destAmount` XLM by spending `sourceAssetCode`.
 * @param {{ sourceAssetCode: string, sourceAssetIssuer?: string, destAmount: number|string }} params
 * @returns {Promise<{ sourceAmount: number, path: object[] }>}
 * @throws {{ code: 'no_path' }} if no DEX path exists
 */
async function getPathPaymentEstimate({ sourceAssetCode, sourceAssetIssuer, destAmount }) {
  const sourceAsset =
    sourceAssetCode === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(sourceAssetCode, sourceAssetIssuer);
  const destAsset = StellarSdk.Asset.native();
  const paths = await server
    .strictReceivePaths(sourceAsset, destAsset, String(parseFloat(destAmount).toFixed(7)))
    .call();
  if (!paths.records || paths.records.length === 0) {
    const e = new Error(`No payment path found from ${sourceAssetCode} to XLM`);
    e.code = 'no_path';
    throw e;
  }
  const best = paths.records[0];
  return { sourceAmount: parseFloat(best.source_amount), path: best.path };
}

/**
 * Executes a path payment, letting the buyer pay in `sourceAssetCode` and the receiver get XLM.
 * @param {{ senderSecret: string, sourceAssetCode: string, sourceAssetIssuer?: string, sendMax: number|string, receiverPublicKey: string, destAmount: number|string, memo?: string }} params
 * @returns {Promise<string>} Transaction hash
 */
async function pathPayment({ senderSecret, sourceAssetCode, sourceAssetIssuer, sendMax, receiverPublicKey, destAmount, memo }) {
  const keypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const account = await server.loadAccount(keypair.publicKey());
  const sourceAsset =
    sourceAssetCode === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(sourceAssetCode, sourceAssetIssuer);
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(
      StellarSdk.Operation.pathPaymentStrictReceive({
        sendAsset: sourceAsset,
        sendMax: parseFloat(sendMax).toFixed(7),
        destination: receiverPublicKey,
        destAsset: StellarSdk.Asset.native(),
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
 * Creates an on-ledger claimable balance (escrow-lite).
 * Farmer can claim unconditionally; buyer can reclaim after 14 days if unclaimed.
 * @param {{ senderSecret: string, farmerPublicKey: string, buyerPublicKey: string, amount: number }} params
 * @returns {Promise<{ txHash: string, balanceId: string }>}
 */
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
  const transaction = new StellarSdk.TransactionBuilder(senderAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
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

/**
 * Claims an existing claimable balance on behalf of the claimant.
 * @param {{ claimantSecret: string, balanceId: string }} params
 * @returns {Promise<string>} Transaction hash
 */
async function claimBalance({ claimantSecret, balanceId }) {
  const claimantKeypair = StellarSdk.Keypair.fromSecret(claimantSecret);
  const claimantAccount = await server.loadAccount(claimantKeypair.publicKey());
  const transaction = new StellarSdk.TransactionBuilder(claimantAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceID: balanceId }))
    .setTimeout(30)
    .build();
  transaction.sign(claimantKeypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

/**
 * Creates a preorder claimable balance that the farmer can only claim after `unlockAtUnix`.
 * @param {{ senderSecret: string, farmerPublicKey: string, amount: number, unlockAtUnix: number }} params
 * @returns {Promise<{ txHash: string, balanceId: string }>}
 */
async function createPreorderClaimableBalance({ senderSecret, farmerPublicKey, amount, unlockAtUnix }) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());
  const farmerClaimant = new StellarSdk.Claimant(
    farmerPublicKey,
    StellarSdk.Claimant.predicateNot(
      StellarSdk.Claimant.predicateBeforeAbsoluteTime(String(unlockAtUnix))
    )
  );
  const transaction = new StellarSdk.TransactionBuilder(senderAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
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

/**
 * Mints reward tokens to a buyer address via the reward-token Soroban contract.
 * Returns null (no-op) when `REWARD_TOKEN_CONTRACT_ID` or `REWARD_TOKEN_ADMIN_SECRET` are unset.
 * @param {string} buyerAddress  Stellar public key of the recipient
 * @param {number} amount        Token amount (i128 units)
 * @returns {Promise<string|null>} Transaction hash, or null on skip/error
 */
async function mintRewardTokens(buyerAddress, amount) {
  const contractId = config.rewardTokenContractId;
  if (!contractId) {
    logger.warn('[Stellar] REWARD_TOKEN_CONTRACT_ID not set, skipping reward mint');
    return null;
  }
  const adminSecret = config.rewardTokenAdminSecret;
  if (!adminSecret) {
    logger.warn('[Stellar] REWARD_TOKEN_ADMIN_SECRET not set, skipping reward mint');
    return null;
  }
  try {
    const adminKeypair = StellarSdk.Keypair.fromSecret(adminSecret);
    const adminAccount = await server.loadAccount(adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(contractId);
    const transaction = new StellarSdk.TransactionBuilder(adminAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
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
    logger.error('[Stellar] Failed to mint reward tokens', { error: error.message });
    return null;
  }
}

/**
 * Burns reward tokens from a buyer address via the reward-token Soroban contract (#847).
 * Uses `burn_reward` (admin-callable, balance-capped) so a low balance is non-fatal.
 * Returns null (no-op) when contract IDs / admin secret are unset.
 * @param {string} buyerAddress  Stellar public key of the holder
 * @param {number} amount        Token amount to burn (i128 units)
 * @returns {Promise<string|null>} Transaction hash, or null on skip/error
 */
async function burnRewardTokens(buyerAddress, amount) {
  const contractId = config.rewardTokenContractId;
  if (!contractId) {
    logger.warn('[Stellar] REWARD_TOKEN_CONTRACT_ID not set, skipping reward burn');
    return null;
  }
  const adminSecret = config.rewardTokenAdminSecret;
  if (!adminSecret) {
    logger.warn('[Stellar] REWARD_TOKEN_ADMIN_SECRET not set, skipping reward burn');
    return null;
  }
  try {
    const adminKeypair = StellarSdk.Keypair.fromSecret(adminSecret);
    const adminAccount = await server.loadAccount(adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(contractId);
    const transaction = new StellarSdk.TransactionBuilder(adminAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
      .addOperation(
        contract.call(
          'burn_reward',
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
    logger.warn('[Stellar] Failed to burn reward tokens (non-fatal)', { error: error.message });
    return null;
  }
}

/**
 * Returns the text memo of a Stellar transaction, or null if absent or unretrievable.
 * @param {string} txHash
 * @returns {Promise<string|null>}
 */
async function getMemo(txHash) {
  if (!txHash) return null;
  try {
    const tx = await server.transactions().transaction(txHash).call();
    if (tx.memo_type === 'text' && tx.memo) return tx.memo;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches the top-10 bids and asks for a trading pair from Horizon.
 * Defaults to XLM/USDC using the configured `USDC_ISSUER`.
 * @param {{ code: string, issuer: string|null }} [baseAsset]
 * @param {{ code: string, issuer: string }} [counterAsset]
 * @returns {Promise<{ bids: object[], asks: object[], midPrice: number }>}
 */
async function getOrderBook(
  baseAsset = { code: 'XLM', issuer: null },
  counterAsset = { code: 'USDC', issuer: config.usdcIssuer }
) {
  const base =
    baseAsset.code === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(baseAsset.code, baseAsset.issuer);
  const counter =
    counterAsset.code === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(counterAsset.code, counterAsset.issuer);
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Order book request timed out')), 5000)
  );
  const result = await Promise.race([server.orderbook(base, counter).call(), timeout]);
  const bids = (result.bids || []).slice(0, 10);
  const asks = (result.asks || []).slice(0, 10);
  const bestBid = bids.length ? parseFloat(bids[0].price) : 0;
  const bestAsk = asks.length ? parseFloat(asks[0].price) : 0;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
  return { bids, asks, midPrice };
}

module.exports = {
  sendPayment,
  getTransactions,
  generatePaymentLink,
  getPlatformFeeInfo,
  getPathPaymentSendMax,
  getPathPaymentEstimate,
  pathPayment,
  createClaimableBalance,
  claimBalance,
  createPreorderClaimableBalance,
  mintRewardTokens,
  burnRewardTokens,
  getMemo,
  getOrderBook,
};
