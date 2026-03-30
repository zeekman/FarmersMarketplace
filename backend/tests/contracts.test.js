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

  it('returns 403 for buyer role', async () => {
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state`)
      .set('Authorization', `Bearer ${BUYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for farmer role', async () => {
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state`)
      .set('Authorization', `Bearer ${FARMER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid contractId format', async () => {
    const res = await request(app)
      .get('/api/contracts/not-a-valid-id/state')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_contract_id');
  });

  it('returns all entries for admin', async () => {
    stellar.getContractState.mockResolvedValueOnce(MOCK_ENTRIES);
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toMatchObject({
      key: 'balance:GABC',
      val: 1000,
      durability: 'Persistent',
    });
    expect(stellar.getContractState).toHaveBeenCalledWith(VALID_CONTRACT_ID, null);
  });

  it('passes prefix query param to getContractState', async () => {
    const filtered = MOCK_ENTRIES.filter((e) => e.key.startsWith('balance'));
    stellar.getContractState.mockResolvedValueOnce(filtered);
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state?prefix=balance`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(stellar.getContractState).toHaveBeenCalledWith(VALID_CONTRACT_ID, 'balance');
  });

  it('returns empty array when no entries match', async () => {
    stellar.getContractState.mockResolvedValueOnce([]);
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state?prefix=nonexistent`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 404 when contract not found', async () => {
    const notFound = Object.assign(new Error('Contract not found'), { code: 404 });
    stellar.getContractState.mockRejectedValueOnce(notFound);
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('contract_not_found');
  });

  it('returns 500 on RPC error', async () => {
    stellar.getContractState.mockRejectedValueOnce(new Error('RPC timeout'));
    const res = await request(app)
      .get(`/api/contracts/${VALID_CONTRACT_ID}/state`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('rpc_error');
  });

  it('accepts 64-char hex contractId', async () => {
    stellar.getContractState.mockResolvedValueOnce([]);
    const res = await request(app)
      .get(`/api/contracts/${'a'.repeat(64)}/state`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
  });
});
