/**
 * setupFilesAfterEnv — executes once per test worker, after Jest is installed
 * but BEFORE any test file is loaded.
 *
 * Mocks db/schema with both the legacy prepare() API (for backward compat)
 * and the new async query() API used by the migrated routes.
 */

// Set env vars before any module is loaded so rate limiters use test values
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
process.env.RATE_LIMIT_GENERAL_MAX = '10000';
process.env.RATE_LIMIT_ORDER_MAX = '10000';
process.env.RATE_LIMIT_SEND_MAX = '10000';
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || 'test-vapid-public-key';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || 'test-vapid-private-key';

// --- DB mock ---
jest.mock('../src/db/schema', () => ({
  prepare: jest.fn(),
  exec: jest.fn(),
  transaction: jest.fn(),
  query: jest.fn(),
  isPostgres: false,
}));

// --- Stellar mock ---
jest.mock('../src/utils/stellar', () => ({
  isTestnet: true,
  server: {
    payments: jest.fn(() => ({
      forAccount: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      stream: jest.fn(() => jest.fn()), // returns a stop function
    })),
  },
  createWallet: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  createWalletFromMnemonic: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET', mnemonic: 'word '.repeat(12).trim() })),
  deriveKeypairFromMnemonic: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  getBalance: jest.fn().mockResolvedValue(1000),
  getTransactions: jest.fn().mockResolvedValue([]),
  fundTestnetAccount: jest.fn().mockResolvedValue({}),
  sendPayment:        jest.fn().mockResolvedValue('TXHASH123'),
  createWallet:           jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  getBalance:             jest.fn().mockResolvedValue(1000),
  getTransactions:        jest.fn().mockResolvedValue([]),
  fundTestnetAccount:     jest.fn().mockResolvedValue({}),
  sendPayment:            jest.fn().mockResolvedValue('TXHASH123'),
  isTestnet:              true,
  createClaimableBalance: jest.fn().mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BALANCE_ID_001' }),
  createPreorderClaimableBalance: jest.fn().mockResolvedValue({ txHash: 'PREORDER_TX', balanceId: 'PREORDER_BALANCE_001' }),
  claimBalance:           jest.fn().mockResolvedValue('CLAIM_TX_001'),
  getContractState:       jest.fn(),
  getContractWasmHash:    jest.fn().mockResolvedValue('0'.repeat(64)),
  simulateContractCall:   jest.fn(),
  sendPayment: jest.fn().mockResolvedValue('TXHASH123'),
  createWallet: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  getBalance: jest.fn().mockResolvedValue(1000),
  getTransactions: jest.fn().mockResolvedValue([]),
  fundTestnetAccount: jest.fn().mockResolvedValue({}),
  sendPayment: jest.fn().mockResolvedValue('TXHASH123'),
  isTestnet: true,
  createClaimableBalance: jest
    .fn()
    .mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BALANCE_ID_001' }),
  createPreorderClaimableBalance: jest
    .fn()
    .mockResolvedValue({ txHash: 'PREORDER_TX', balanceId: 'PREORDER_BALANCE_001' }),
  claimBalance: jest.fn().mockResolvedValue('CLAIM_TX_001'),
}));

// --- Missing utility mocks ---
jest.mock('../src/utils/cdn', () => ({ rewriteImageUrl: (url) => url }));
jest.mock('../src/utils/pushNotifications', () => ({ sendPushToUser: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/utils/geocheck', () => ({ checkGeoFence: jest.fn().mockResolvedValue({ allowed: true }) }));
jest.mock('../src/utils/idempotency', () => ({
  getCachedResponse: jest.fn().mockReturnValue(null),
  cacheResponse: jest.fn(),
}));
jest.mock('../src/services/AutomaticOrderProcessor', () =>
  jest.fn().mockImplementation(() => ({
    processWaitlistOnRestock: jest.fn().mockResolvedValue({ success: true, processed: 0, skipped: 0 }),
  }))
);

// --- Cache mock ---
jest.mock('../src/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
}));

// --- requestLogger mock (uuid is ESM in v13, avoid parse error) ---
jest.mock('../src/middleware/requestLogger', () => (req, res, next) => next());

// --- web-push mock — prevents js-nacl WASM from loading in the test environment ---
jest.mock('web-push', () => ({
  sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
  setVapidDetails: jest.fn(),
  generateVAPIDKeys: jest.fn(() => ({
    publicKey: 'BDd3_hVL7e_J0VL5R5k1sMnfNjz6kgBJyKJMN_ZXGwc',
    privateKey: 'test-private-key-for-jest',
  })),
}));

// --- Routes mock ---
jest.mock('../src/routes', () => {
  const express = require('express');
  const router = express.Router();
  router.use('/api/auth', require('../src/routes/auth'));
  router.use('/api/products', require('../src/routes/products'));
  router.use('/api/orders', require('../src/routes/orders'));
  router.use('/api/orders/:id/return', require('../src/routes/returns'));
  router.use('/api/analytics', require('../src/routes/analytics'));
  router.use('/api/notifications', require('../src/routes/notifications'));
  return router;
});

// --- Mailer mock ---
jest.mock('../src/utils/mailer', () => ({
  sendOrderEmails: jest.fn().mockResolvedValue({}),
  sendLowStockAlert: jest.fn().mockResolvedValue({}),
  sendStatusUpdateEmail: jest.fn().mockResolvedValue({}),
  sendBackInStockEmail: jest.fn().mockResolvedValue({}),
  sendReturnEmail: jest.fn().mockResolvedValue({}),
  sendFreshnessAlert: jest.fn().mockResolvedValue({}),
  sendProductExpiredEmail: jest.fn().mockResolvedValue({}),
  sendContractAlert: jest.fn().mockResolvedValue({}),
  sendAuctionWinnerEmail: jest.fn().mockResolvedValue({}),
  sendAuctionSaleEmail: jest.fn().mockResolvedValue({}),
  sendAuctionNoSaleEmail: jest.fn().mockResolvedValue({}),
  sendSubscriptionPaymentFailedEmail: jest.fn().mockResolvedValue({}),
}));

// --- requestLogger mock (uuid v13 is ESM-only, incompatible with Jest CJS) ---
jest.mock('../src/middleware/requestLogger', () => (req, res, next) => {
  req.requestId = 'test-request-id';
  next();
});

// Reset all mocks before each test to prevent queue leakage
beforeEach(() => {
  jest.resetAllMocks();
  // Re-apply default implementations after reset
  const mockDb = jest.requireMock('../src/db/schema');
  mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  mockDb.prepare = jest.fn(() => ({
    get: jest.fn(),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
  }));
  mockDb.exec = jest.fn();
  mockDb.transaction = jest.fn(
    (fn) =>
      (...args) =>
        fn(...args)
  );

  const stellar = jest.requireMock('../src/utils/stellar');
  if (stellar.createWallet) stellar.createWallet.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  if (stellar.createWalletFromMnemonic) stellar.createWalletFromMnemonic.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET', mnemonic: 'word '.repeat(12).trim() });
  if (stellar.deriveKeypairFromMnemonic) stellar.deriveKeypairFromMnemonic.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  if (stellar.getBalance) stellar.getBalance.mockResolvedValue(1000);
  if (stellar.getTransactions) stellar.getTransactions.mockResolvedValue({ records: [], next_cursor: null, prev_cursor: null });
  if (stellar.fundTestnetAccount) stellar.fundTestnetAccount.mockResolvedValue({});
  if (stellar.sendPayment) stellar.sendPayment.mockResolvedValue('TXHASH123');
  stellar.isTestnet = true;
  if (stellar.createClaimableBalance) stellar.createClaimableBalance.mockResolvedValue({
    txHash: 'ESCROW_TX',
    balanceId: 'BALANCE_ID_001',
  });
  if (stellar.claimBalance) stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
  stellar.createWallet?.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.createWalletFromMnemonic?.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET', mnemonic: 'word '.repeat(12).trim() });
  stellar.deriveKeypairFromMnemonic?.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.getBalance?.mockResolvedValue(1000);
  stellar.getTransactions?.mockResolvedValue({ records: [], next_cursor: null, prev_cursor: null });
  stellar.fundTestnetAccount?.mockResolvedValue({});
  stellar.sendPayment?.mockResolvedValue('TXHASH123');
  stellar.isTestnet = true;
  stellar.createClaimableBalance?.mockResolvedValue({
    txHash: 'ESCROW_TX',
    balanceId: 'BALANCE_ID_001',
  });
  stellar.claimBalance?.mockResolvedValue('CLAIM_TX_001');
  stellar.simulateContractCall = jest.fn();
  stellar.getContractWasmHash = jest.fn().mockResolvedValue('0'.repeat(64));

  const mailer = jest.requireMock('../src/utils/mailer');
  mailer.sendOrderEmails.mockResolvedValue({});
  mailer.sendLowStockAlert.mockResolvedValue({});
  mailer.sendStatusUpdateEmail.mockResolvedValue({});
  mailer.sendBackInStockEmail.mockResolvedValue({});
  mailer.sendReturnEmail.mockResolvedValue({});
  if (mailer.sendOrderEmails) mailer.sendOrderEmails.mockResolvedValue({});
  if (mailer.sendLowStockAlert) mailer.sendLowStockAlert.mockResolvedValue({});
  if (mailer.sendStatusUpdateEmail) mailer.sendStatusUpdateEmail.mockResolvedValue({});
  if (mailer.sendBackInStockEmail) mailer.sendBackInStockEmail.mockResolvedValue({});
  if (mailer.sendAuctionWinnerEmail) mailer.sendAuctionWinnerEmail.mockResolvedValue({});
  if (mailer.sendAuctionSaleEmail) mailer.sendAuctionSaleEmail.mockResolvedValue({});
  if (mailer.sendAuctionNoSaleEmail) mailer.sendAuctionNoSaleEmail.mockResolvedValue({});
  if (mailer.sendSubscriptionPaymentFailedEmail) mailer.sendSubscriptionPaymentFailedEmail.mockResolvedValue({});
  mailer.sendOrderEmails?.mockResolvedValue({});
  mailer.sendLowStockAlert?.mockResolvedValue({});
  mailer.sendStatusUpdateEmail?.mockResolvedValue({});
  mailer.sendBackInStockEmail?.mockResolvedValue({});
});
