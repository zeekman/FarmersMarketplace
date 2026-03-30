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

describe('POST /api/contracts/:contractId/simulate', () => {
  let stellar;
  let db;

  beforeEach(() => {
    stellar = jest.requireMock('../src/utils/stellar');
    db = jest.requireMock('../src/db/schema');
    stellar.simulateContractCall = jest.fn();
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .send({ method: 'deposit', args: [] });
    expect(res.status).toBe(401);
  });

  it('returns 403 for buyer role', async () => {
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${BUYER_TOKEN}`)
      .send({ method: 'deposit', args: [] });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid contractId format', async () => {
    const res = await request(app)
      .post('/api/contracts/not-valid/simulate')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'x', args: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_contract_id');
  });

  it('returns 400 when method is missing', async () => {
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ args: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
    expect(stellar.simulateContractCall).not.toHaveBeenCalled();
  });

  it('returns 400 when args is not an array', async () => {
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'x', args: {} });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
  });

  it('returns 404 when contract is not registered', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'deposit', args: [] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('contract_not_found');
    expect(stellar.simulateContractCall).not.toHaveBeenCalled();
  });

  it('returns 404 when registered network does not match STELLAR_NETWORK', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: VALID_CONTRACT_ID, network: 'mainnet' }],
      rowCount: 1,
    });
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'deposit', args: [] });
    expect(res.status).toBe(404);
    expect(stellar.simulateContractCall).not.toHaveBeenCalled();
  });

  it('returns simulation body and calls simulateContractCall', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: VALID_CONTRACT_ID, network: 'testnet' }],
      rowCount: 1,
    });
    const payload = { success: true, fee: '10100', result: { ok: true }, error: null };
    stellar.simulateContractCall.mockResolvedValueOnce(payload);
    const args = [{ type: 'u64', value: '1' }];
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'balance', args });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(stellar.simulateContractCall).toHaveBeenCalledWith(
      VALID_CONTRACT_ID,
      'balance',
      args,
    );
  });

  it('defaults args to empty array', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: VALID_CONTRACT_ID, network: 'testnet' }],
      rowCount: 1,
    });
    stellar.simulateContractCall.mockResolvedValueOnce({
      success: true,
      fee: '100',
      result: null,
      error: null,
    });
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'version' });
    expect(res.status).toBe(200);
    expect(stellar.simulateContractCall).toHaveBeenCalledWith(
      VALID_CONTRACT_ID,
      'version',
      [],
    );
  });

  it('returns 503 when simulation source is not configured', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: VALID_CONTRACT_ID, network: 'testnet' }],
      rowCount: 1,
    });
    const err = Object.assign(new Error('Configure public key'), {
      code: 'simulation_source_unconfigured',
    });
    stellar.simulateContractCall.mockRejectedValueOnce(err);
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'x', args: [] });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('simulation_source_unconfigured');
  });

  it('returns 400 when simulateContractCall throws invalid_arg', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: VALID_CONTRACT_ID, network: 'testnet' }],
      rowCount: 1,
    });
    const err = Object.assign(new Error('args[0] must be an object'), {
      code: 'invalid_arg',
    });
    stellar.simulateContractCall.mockRejectedValueOnce(err);
    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ method: 'x', args: ['bad'] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_arg');
  });
});
