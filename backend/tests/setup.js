/**
 * Shared test helpers.
 * The global beforeEach in jest.setup.js handles mock resets.
 */

process.env.JWT_SECRET             = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV               = 'test';
process.env.RATE_LIMIT_AUTH_MAX    = '10000';
process.env.RATE_LIMIT_GENERAL_MAX = '10000';
process.env.RATE_LIMIT_ORDER_MAX   = '10000';
process.env.RATE_LIMIT_SEND_MAX    = '10000';

const mockDb = jest.requireMock('../src/db/schema');

// Expose mockQuery as a getter so it always points to the current mock function
// (jest.setup.js replaces mockDb.query in beforeEach)
const mockQueryProxy = new Proxy({}, {
  get: (_, prop) => mockDb.query[prop].bind(mockDb.query),
  apply: (_, thisArg, args) => mockDb.query(...args),
});

// Simple reference — tests should use mockDb.query directly or via this export
const getMockQuery = () => mockDb.query;

const request = require('supertest');
const app = require('../src/app');

async function getCsrf() {
  const res = await request(app).get('/api/csrf-token');
  const setCookie = res.headers['set-cookie'] || [];
  const cookieStr = setCookie.find(c => c.startsWith('csrf_token=')) || '';
  const token = cookieStr.split(';')[0].split('=')[1];
  return { token, cookieStr };
}

module.exports = {
  request,
  app,
  mockDb,
  get mockQuery() { return mockDb.query; },
  get mockRun() { return mockDb.prepare()?.run; },
  get mockGet() { return mockDb.prepare()?.get; },
  get mockAll() { return mockDb.prepare()?.all; },
  mockPrepare: mockDb.prepare,
  get mockTransaction() { return mockDb.transaction; },
  getCsrf,
};
