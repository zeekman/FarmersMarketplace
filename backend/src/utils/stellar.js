const StellarSdk = require('@stellar/stellar-sdk');

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

// Create a new Stellar keypair (wallet)
function createWallet() {
  const keypair = StellarSdk.Keypair.random();
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

// Fund testnet account via Friendbot
async function fundTestnetAccount(publicKey) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  return response.json();
}

// Get account balance
async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === 'native');
    return xlm ? parseFloat(xlm.balance) : 0;
  } catch {
    return 0; // account not yet funded
  }
}

// Send XLM payment from buyer to farmer
async function sendPayment({ senderSecret, receiverPublicKey, amount, memo }) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: receiverPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
      })
    )
    .addMemo(StellarSdk.Memo.text(memo || 'FarmersMarket'))
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

// Get transaction history for a public key
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

async function getContractState(contractId, prefix = null) {
  const sorobanRpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org');
  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);

  const entries = [];
  let hasMore = true;
  let cursor = null;

  while (hasMore) {
    const response = await sorobanServer.getContractData(contractId, cursor);

    if (response.data) {
      const entry = {
        key: StellarSdk.scValToNative(response.data.key, { asString: true }),
        val: StellarSdk.scValToNative(response.data.val, { asString: true }),
        durability: response.data.durability || 'Persistent',
      };
      if (!prefix || entry.key.startsWith(prefix)) {
        entries.push(entry);
      }
    }

    hasMore = response.latestLedger;
    cursor = response.pagingToken;
  }

  return entries;
}

module.exports = {
  isTestnet,
  createWallet,
  fundTestnetAccount,
  getBalance,
  sendPayment,
  getTransactions,
  getContractState,
};
