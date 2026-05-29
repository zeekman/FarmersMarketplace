/**
 * Tests for GET /api/contracts/:contractId/state
 * The global jest.setup.js already mocks utils/stellar.
 * We just override getContractState per-test.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

const SECRET = process.env.JWT_SECRET;
const token = (id, role) => jwt.sign({ id, role }, SECRET);

const ADMIN_TOKEN = token(1, 'admin');
const BUYER_TOKEN = token(2, 'buyer');
const FARMER_TOKEN = token(3, 'farmer');

// Valid 56-char base32 Stellar contract ID
const VALID_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

const MOCK_ENTRIES = [
  { key: 'balance:GABC', val: 1000, durability: 'Persistent' },
  { key: 'owner', val: 'GABC123', durability: 'Persistent' },
  { key: 'temp_nonce', val: 42, durability: 'Temporary' },
];

describe('GET /api/contracts/:contractId/state', () => {
  let stellar;

  beforeEach(() => {
    stellar = jest.requireMock('../src/utils/stellar');
    stellar.getContractState = jest.fn();
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(app).get(`/api/contracts/${VALID_CONTRACT_ID}/state`);
    expect(res.status).toBe(401);
  });
});
