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
  getBalance: jest.fn().mockResolvedValue(1000),
  getTransactions: jest.fn().mockResolvedValue([]),
  fundTestnetAccount: jest.fn().mockResolvedValue({}),
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

// --- Mailer mock ---
jest.mock('../src/utils/mailer', () => ({
  sendOrderEmails: jest.fn().mockResolvedValue({}),
  sendLowStockAlert: jest.fn().mockResolvedValue({}),
  sendStatusUpdateEmail: jest.fn().mockResolvedValue({}),
  sendBackInStockEmail: jest.fn().mockResolvedValue({}),
}));

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
  stellar.createWallet.mockReturnValue({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' });
  stellar.getBalance.mockResolvedValue(1000);
  stellar.getTransactions.mockResolvedValue([]);
  stellar.fundTestnetAccount.mockResolvedValue({});
  stellar.sendPayment.mockResolvedValue('TXHASH123');
  stellar.isTestnet = true;
  stellar.createClaimableBalance.mockResolvedValue({
    txHash: 'ESCROW_TX',
    balanceId: 'BALANCE_ID_001',
  });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');

  const mailer = jest.requireMock('../src/utils/mailer');
  mailer.sendOrderEmails.mockResolvedValue({});
  mailer.sendLowStockAlert.mockResolvedValue({});
  mailer.sendStatusUpdateEmail.mockResolvedValue({});
  mailer.sendBackInStockEmail.mockResolvedValue({});
});
