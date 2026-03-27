/**
 * setupFilesAfterEnv — executes once per test worker, after Jest is installed
 * but BEFORE any test file is loaded. Placing jest.mock() here guarantees the
 * mocks are registered before schema.js is ever evaluated, so better-sqlite3
 * never opens market.db and there are no file-lock or race-condition issues
 * when tests run in parallel workers.
 */

// --- DB mock ---
jest.mock("../src/db/schema", () => ({
  prepare: jest.fn(),
  exec: jest.fn(),
  transaction: jest.fn(),
}));

// --- Stellar mock ---
jest.mock('../src/utils/stellar', () => ({
  createWallet:           jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  getBalance:             jest.fn().mockResolvedValue(1000),
  getTransactions:        jest.fn().mockResolvedValue([]),
  fundTestnetAccount:     jest.fn().mockResolvedValue({}),
  sendPayment:            jest.fn().mockResolvedValue('TXHASH123'),
  createClaimableBalance: jest.fn().mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BALANCE_ID_001' }),
  claimBalance:           jest.fn().mockResolvedValue('CLAIM_TX_001'),
}));

// --- Mailer mock ---
jest.mock('../src/utils/mailer', () => ({
  sendOrderEmails:      jest.fn().mockResolvedValue({}),
  sendLowStockAlert:    jest.fn().mockResolvedValue({}),
  sendStatusUpdateEmail: jest.fn().mockResolvedValue({}),
  sendOrderEmails:       jest.fn().mockResolvedValue({}),
  sendLowStockAlert:     jest.fn().mockResolvedValue({}),
  sendStatusUpdateEmail: jest.fn().mockResolvedValue({}),
  sendBackInStockEmail:  jest.fn().mockResolvedValue({}),
}));
