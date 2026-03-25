/**
 * Shared test helpers.
 * DB is fully mocked — no native SQLite bindings required.
 */

// --- DB mock ---
// Each test file can override these via jest.spyOn or by reassigning mockDb.*
const mockRun  = jest.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 });
const mockGet  = jest.fn();
const mockAll  = jest.fn().mockReturnValue([]);
const mockExec = jest.fn();

const mockPrepare = jest.fn(() => ({ get: mockGet, all: mockAll, run: mockRun }));

// transaction() immediately invokes the callback and returns its result
const mockTransaction = jest.fn((fn) => (...args) => fn(...args));

const mockDb = {
  prepare: mockPrepare,
  exec: mockExec,
  transaction: mockTransaction,
};

jest.mock('../src/db/schema', () => mockDb);

// --- Stellar mock ---
jest.mock('../src/utils/stellar', () => ({
  createWallet:       jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
  getBalance:         jest.fn().mockResolvedValue(1000),
  getTransactions:    jest.fn().mockResolvedValue([]),
  fundTestnetAccount: jest.fn().mockResolvedValue({}),
  sendPayment:        jest.fn().mockResolvedValue('TXHASH123'),
}));

// --- Mailer mock ---
jest.mock('../src/utils/mailer', () => ({
  sendOrderEmails: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app     = require('../src/app');

module.exports = { request, app, mockDb, mockRun, mockGet, mockAll, mockPrepare, mockTransaction };
