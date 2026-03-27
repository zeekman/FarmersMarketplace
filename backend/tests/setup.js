/**
 * Shared test helpers.
 *
 * jest.mock() declarations live in jest.setup.js (setupFilesAfterEnv) so they
 * are guaranteed to intercept schema.js before better-sqlite3 can open any
 * .db file — eliminating file-lock and race-condition failures in parallel runs.
 *
 * This file retrieves the mock handles via jest.requireMock() and wires up the
 * prepare() factory so every call returns { get, all, run } pointing at the
 * shared mock functions, matching the real better-sqlite3 Statement API.
 */

// Must be set before app.js is required — app validates this on load
process.env.JWT_SECRET             = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV               = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';
// Raise rate limits so tests don't get throttled
process.env.RATE_LIMIT_AUTH_MAX    = '10000';
process.env.RATE_LIMIT_GENERAL_MAX = '10000';
process.env.RATE_LIMIT_ORDER_MAX   = '10000';

// --- DB mock ---
// Each test file can override these via jest.spyOn or by reassigning mockDb.*
const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 });
const mockGet = jest.fn();
const mockAll = jest.fn().mockReturnValue([]);
const mockExec = jest.fn();
const mockTransaction = jest.fn(
  (fn) =>
    (...args) =>
      fn(...args),
);
const mockPrepare = jest.fn(() => ({
  get: mockGet,
  all: mockAll,
  run: mockRun,
}));

// Wire the handles into the already-registered mock module.
const mockDb = jest.requireMock("../src/db/schema");
mockDb.prepare = mockPrepare;
mockDb.exec = mockExec;
mockDb.transaction = mockTransaction;

const request = require("supertest");
const app = require("../src/app");

// Helper: fetch a real CSRF token from the app
async function getCsrf() {
  const res = await request(app).get("/api/csrf-token");
  const setCookie = res.headers["set-cookie"] || [];
  const cookieStr = setCookie.find((c) => c.startsWith("csrf_token=")) || "";
  const token = cookieStr.split(";")[0].split("=")[1];
  return { token, cookieStr };
}

module.exports = {
  request,
  app,
  mockDb,
  mockRun,
  mockGet,
  mockAll,
  mockExec,
  mockPrepare,
  mockTransaction,
  getCsrf,
};
