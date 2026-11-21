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
process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'test-encryption-secret-32-bytes-';
process.env.RATE_LIMIT_ORDER_USER_MAX = process.env.RATE_LIMIT_ORDER_USER_MAX || '10000';

// --- DB mock ---
jest.mock('../src/db/schema', () => ({
  prepare: jest.fn(),
  exec: jest.fn(),
  transaction: jest.fn(),
  query: jest.fn(),
  isPostgres: false,
  statementMocks: {
    get: jest.fn(),
    all: jest.fn(),
    run: jest.fn(),
  },
}));

jest.mock('../src/utils/stellar', () => ({
  STELLAR_NETWORK: 'testnet',
  isTestnet: true,
  createWallet: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  createWalletFromMnemonic: jest.fn(() => ({
    publicKey: 'GPUBKEY',
    secretKey: 'SSECRET',
    mnemonic: 'word '.repeat(12).trim(),
  })),
  deriveKeypairFromMnemonic: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  fundTestnetAccount: jest.fn().mockResolvedValue({}),
  getBalance: jest.fn().mockResolvedValue(1000),
  getPlatformFeeInfo: jest.fn((amount) => ({
    feePercent: 0,
    feeAmount: 0,
    farmerAmount: amount,
  })),
  getTransactions: jest.fn().mockResolvedValue([]),
  generatePaymentLink: jest.fn(() => 'web+stellar:pay?test'),
  mintRewardTokens: jest.fn().mockResolvedValue({}),
  fundTestnetAccount: jest.fn().mockResolvedValue({}),
  sendPayment:        jest.fn().mockResolvedValue('TXHASH123'),
  getPlatformFeeInfo: jest.fn((amount) => ({ feePercent: 0, feeAmount: 0, farmerAmount: amount, platformWallet: null })),
  getPathPaymentSendMax: jest.fn((sourceAmount, slippagePercent = 0.5) => Number(sourceAmount) * (1 + slippagePercent / 100)),
  getPathPaymentEstimate: jest.fn().mockResolvedValue({ sourceAmount: 2, path: [] }),
  generatePaymentLink: jest.fn(() => 'web+stellar:pay?destination=TEST'),
  getMemo: jest.fn().mockResolvedValue(null),
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
  recordCarbonOffset:     jest.fn().mockResolvedValue({}),
  getCarbonOffset:        jest.fn(),
  invokeContract:         jest.fn(),
  invokeEscrowContract:   jest.fn().mockResolvedValue({ txHash: 'ESCROW_TX' }),
  mintRewardTokens:       jest.fn().mockResolvedValue({}),
  burnRewardTokens:       jest.fn().mockResolvedValue({}),
  sendPayment: jest.fn().mockResolvedValue('TXHASH123'),
  createWallet: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  getBalance: jest.fn().mockResolvedValue(1000),
  getTransactions: jest.fn().mockResolvedValue({ records: [], next_cursor: null, prev_cursor: null }),
  sendPayment: jest.fn().mockResolvedValue('TXHASH123'),
  getOrderBook: jest.fn().mockResolvedValue({ bids: [], asks: [], base: 'XLM', counter: 'USDC' }),
  createClaimableBalance: jest
    .fn()
    .mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BALANCE_ID_001' }),
  createPreorderClaimableBalance: jest
    .fn()
    .mockResolvedValue({ txHash: 'PREORDER_TX', balanceId: 'PREORDER_BALANCE_001' }),
  claimBalance: jest.fn().mockResolvedValue('CLAIM_TX_001'),
  getContractState: jest.fn(),
  getContractWasmHash: jest.fn().mockResolvedValue('0'.repeat(64)),
  simulateContractCall: jest.fn(),
  invokeContract: jest.fn(),
  simulateContract: jest.fn(),
  invokeEscrowContract: jest.fn().mockResolvedValue({ txHash: 'ESCROW_TX' }),
  burnRewardTokens: jest.fn().mockResolvedValue({}),
  getContractEvents: jest.fn().mockResolvedValue({ events: [] }),
  server: {
    payments: jest.fn(() => ({
      forAccount: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      stream: jest.fn(() => jest.fn()),
    })),
  },
}));


// --- Missing utility mocks ---
jest.mock('../src/utils/cdn', () => ({ rewriteImageUrl: (url) => url }));
jest.mock('../src/utils/pushNotifications', () => ({ sendPushToUser: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/utils/geocheck', () => ({
  checkGeoFence: jest.fn().mockResolvedValue({ allowed: true }),
  checkCoordinateGeoFence: jest.fn(() => ({ allowed: true })),
  checkCoordinateGeoFence: jest.fn().mockReturnValue({ checked: false, allowed: true, distanceKm: null, reason: null }),
}));
jest.mock('../src/utils/idempotency', () => ({
  getCachedResponse: jest.fn().mockReturnValue(null),
  claimIdempotencyKey: jest.fn().mockResolvedValue({ status: 'claimed' }),
  releaseIdempotencyKey: jest.fn().mockResolvedValue(undefined),
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
  router.use('/api', require('../src/routes/reviews'));
  router.use('/api/disputes', require('../src/routes/disputes'));
  router.use('/api/analytics', require('../src/routes/analytics'));
  router.use('/api/notifications', require('../src/routes/notifications'));
  router.use('/api/creator-earnings', require('../src/routes/creatorEarnings'));
  router.use('/api/admin', require('../src/routes/admin'));
  router.use('/api/admin', require('../src/routes/adminBan'));           // #1028 ban/unban audit
  router.use('/api/admin/audit-log', require('../src/routes/adminAuditLog'));  // #1028 audit log endpoint
  router.use('/api/admin/uploads', require('../src/routes/adminOrphanedUploads')); // #1025 orphaned uploads
  router.use('/api/contracts', require('../src/routes/contracts'));       // #1028 contract simulate audit
  router.use('/api/calendar', require('../src/routes/calendar'));
  router.use('/api/batches', require('../src/routes/batches'));
  router.use('/api/network', require('../src/routes/network'));
  router.use('/api/market', require('../src/routes/market'));
  // #1004 bundles & bundle-discounts
  router.use('/api/bundles', require('../src/routes/bundles'));
  router.use('/api/farmers', require('../src/routes/bundleDiscounts'));
  // #1005 product import
  router.use('/api/products/import', require('../src/routes/productImport'));
  // #1006 product videos
  router.use('/api/products', require('../src/routes/productVideos'));
  // #1007 product share
  router.use('/api/products', require('../src/routes/productShare'));
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
  sendDisputeOpenedEmail: jest.fn().mockResolvedValue({}),
  sendDisputeResolvedEmail: jest.fn().mockResolvedValue({}),
}));

// --- requestLogger mock (uuid v13 is ESM-only, incompatible with Jest CJS) ---
jest.mock('../src/middleware/requestLogger', () => (req, res, next) => {
  req.requestId = 'test-request-id';
  next();
});

// Reset all mocks before each test to prevent queue leakage
beforeEach(() => {
  jest.resetAllMocks();
  // Re-apply default implementations without replacing the mock function identity.
  // The app and its tests share the same mock object, so the same function is used
  // across route execution and assertions.
  // Re-apply default implementations after reset
  const geocheck = jest.requireMock('../src/utils/geocheck');
  geocheck.checkGeoFence.mockResolvedValue({ allowed: true });
  geocheck.checkCoordinateGeoFence.mockReturnValue({ checked: false, allowed: true, distanceKm: null, reason: null });

  const mockDb = jest.requireMock('../src/db/schema');
  if (!mockDb.query || typeof mockDb.query.mockReset !== 'function') {
    mockDb.query = jest.fn();
  }
  mockDb.query.mockReset();
  mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  if (!mockDb.prepare || typeof mockDb.prepare.mockReset !== 'function') {
    mockDb.prepare = jest.fn();
  }
  mockDb.prepare.mockReset();
  if (!mockDb.statementMocks) {
    mockDb.statementMocks = { get: jest.fn(), all: jest.fn(), run: jest.fn() };
  }
  mockDb.prepare.mockReturnValue(mockDb.statementMocks);
  mockDb.statementMocks.all.mockReturnValue([]);
  mockDb.statementMocks.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
  if (!mockDb.exec || typeof mockDb.exec.mockReset !== 'function') {
    mockDb.exec = jest.fn();
  }
  mockDb.exec.mockReset();
  if (!mockDb.transaction || typeof mockDb.transaction.mockReset !== 'function') {
    mockDb.transaction = jest.fn();
  }
  mockDb.transaction.mockReset();
  mockDb.transaction.mockImplementation(
    (fn) =>
      (...args) =>
        fn(...args)
  );

  const idempotency = jest.requireMock('../src/utils/idempotency');
  idempotency.getCachedResponse.mockResolvedValue(null);
  idempotency.cacheResponse.mockResolvedValue(undefined);

  const stellar = jest.requireMock('../src/utils/stellar');
  stellar.createWallet.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.createWalletFromMnemonic.mockReturnValue({
    publicKey: 'GPUBKEY',
    secretKey: 'SSECRET',
    mnemonic: 'word '.repeat(12).trim(),
  });
  stellar.deriveKeypairFromMnemonic.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.fundTestnetAccount.mockResolvedValue({});
  stellar.getBalance.mockResolvedValue(1000);
  stellar.getTransactions.mockResolvedValue({ records: [], next_cursor: null, prev_cursor: null });
  stellar.sendPayment.mockResolvedValue('TXHASH123');
  stellar.getOrderBook.mockResolvedValue({ bids: [], asks: [], base: 'XLM', counter: 'USDC' });
  stellar.createClaimableBalance.mockResolvedValue({
    txHash: 'ESCROW_TX',
    balanceId: 'BALANCE_ID_001',
  });
  stellar.createPreorderClaimableBalance.mockResolvedValue({
    txHash: 'PREORDER_TX',
    balanceId: 'PREORDER_BALANCE_001',
  });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
  stellar.getContractWasmHash.mockResolvedValue('0'.repeat(64));
  stellar.invokeEscrowContract.mockResolvedValue({ txHash: 'ESCROW_TX' });
  stellar.burnRewardTokens.mockResolvedValue({});
  if (stellar.claimBalance) stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
  stellar.createWallet?.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.createWalletFromMnemonic?.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET', mnemonic: 'word '.repeat(12).trim() });
  stellar.deriveKeypairFromMnemonic?.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.getBalance?.mockResolvedValue(1000);
  stellar.getTransactions?.mockResolvedValue({ records: [], next_cursor: null, prev_cursor: null });
  stellar.fundTestnetAccount?.mockResolvedValue({});
  stellar.sendPayment?.mockResolvedValue('TXHASH123');
  stellar.getPlatformFeeInfo?.mockReturnValue({ feePercent: 0, feeAmount: 0, farmerAmount: 10, platformWallet: null });
  stellar.getMemo?.mockResolvedValue(null);
  stellar.generatePaymentLink?.mockReturnValue('web+stellar:pay?destination=TEST');
  stellar.isTestnet = true;
  stellar.createClaimableBalance?.mockResolvedValue({
    txHash: 'ESCROW_TX',
    balanceId: 'BALANCE_ID_001',
  });
  stellar.claimBalance?.mockResolvedValue('CLAIM_TX_001');
  stellar.simulateContractCall = jest.fn();
  stellar.recordCarbonOffset = jest.fn().mockResolvedValue({});
  stellar.getCarbonOffset = jest.fn();
  stellar.invokeContract = jest.fn();
  stellar.getContractWasmHash = jest.fn().mockResolvedValue('0'.repeat(64));
  stellar.getOrderBook?.mockResolvedValue({ bids: [], asks: [], base: 'XLM', counter: 'USDC' });
  if (stellar.invokeEscrowContract) stellar.invokeEscrowContract.mockResolvedValue({ txHash: 'ESCROW_TX' });
  if (stellar.mintRewardTokens) stellar.mintRewardTokens.mockResolvedValue({});
  if (stellar.burnRewardTokens) stellar.burnRewardTokens.mockResolvedValue({});

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
  if (mailer.sendDisputeOpenedEmail) mailer.sendDisputeOpenedEmail.mockResolvedValue({});
  if (mailer.sendDisputeResolvedEmail) mailer.sendDisputeResolvedEmail.mockResolvedValue({});
  mailer.sendOrderEmails?.mockResolvedValue({});
  mailer.sendLowStockAlert?.mockResolvedValue({});
  mailer.sendStatusUpdateEmail?.mockResolvedValue({});
  mailer.sendBackInStockEmail?.mockResolvedValue({});

  const signerService = require('../src/services/signerService');
  if (signerService && signerService.getKeystore) {
    const ks = signerService.getKeystore();
    if (ks && typeof ks.setKey === 'function') {
      ks.clear?.();
      ks.setKey('1', { secretKey: 'SSECRET', publicKey: 'GPUBKEY' });
      ks.setKey('2', { secretKey: 'SSECRET_BUYER', publicKey: 'GPUB_BUYER' });
    }
  }
});
