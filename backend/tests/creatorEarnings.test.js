'use strict';

process.env.SOROBAN_CREATOR_EARNINGS_CONTRACT_ID =
  process.env.SOROBAN_CREATOR_EARNINGS_CONTRACT_ID || 'CEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID =
  process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID || 'CCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

const { request, app, mockQuery } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');
const jwt = require('jsonwebtoken');
const StellarSdk = require('@stellar/stellar-sdk');

// Mock idempotency utilities so we can control cache behaviour in tests
jest.mock('../src/utils/idempotency', () => ({
  getCachedResponse: jest.fn(),
  cacheResponse: jest.fn(),
}));
const { getCachedResponse, cacheResponse } = require('../src/utils/idempotency');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';

const farmerKeypair = StellarSdk.Keypair.random();
const FARMER_ADDRESS = farmerKeypair.publicKey();

const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });
const otherFarmerToken = jwt.sign({ id: 2, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

const farmerRow = {
  id: 1,
  stellar_public_key: FARMER_ADDRESS,
  stellar_secret_key: farmerKeypair.secret(),
};

// A valid UUID v4 for use in tests
const VALID_KEY = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  getCachedResponse.mockResolvedValue(null); // no cached response by default
  cacheResponse.mockResolvedValue(undefined);
});

describe('GET /api/creator-earnings/:address/balance', () => {
  test('401 if no token provided', async () => {
    const res = await request(app).get(`/api/creator-earnings/${FARMER_ADDRESS}/balance`);
    expect(res.status).toBe(401);
  });

  test('400 if address is not a valid Stellar public key', async () => {
    const res = await request(app)
      .get('/api/creator-earnings/not-a-real-address/balance')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_address');
  });

  test('404 if no farmer account is associated with the address', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(`/api/creator-earnings/${FARMER_ADDRESS}/balance`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('farmer_not_found');
  });

  test("403 if the address belongs to a different farmer", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...farmerRow, id: 2 }], rowCount: 1 });
    const res = await request(app)
      .get(`/api/creator-earnings/${FARMER_ADDRESS}/balance`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('200 — returns the claimable balance in XLM', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 });
    stellar.simulateContractCall.mockResolvedValueOnce({ success: true, fee: '100', result: 50_000_000, error: null });

    const res = await request(app)
      .get(`/api/creator-earnings/${FARMER_ADDRESS}/balance`)
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.balance_xlm).toBe(5);
    expect(stellar.simulateContractCall).toHaveBeenCalledWith(
      process.env.SOROBAN_CREATOR_EARNINGS_CONTRACT_ID,
      'balance',
      [{ type: 'address', value: FARMER_ADDRESS }],
    );
  });

  test('502 — RPC failure is surfaced gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 });
    stellar.simulateContractCall.mockResolvedValueOnce({ success: false, fee: null, result: null, error: 'RPC down' });

    const res = await request(app)
      .get(`/api/creator-earnings/${FARMER_ADDRESS}/balance`)
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('rpc_error');
  });
});

describe('GET /api/creator-earnings/:address/lifetime', () => {
  test("403 if the address belongs to a different farmer", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...farmerRow, id: 2 }], rowCount: 1 });
    const res = await request(app)
      .get(`/api/creator-earnings/${FARMER_ADDRESS}/lifetime`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('200 — returns lifetime earnings in XLM', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 });
    stellar.simulateContractCall.mockResolvedValueOnce({ success: true, fee: '100', result: 123_000_000, error: null });

    const res = await request(app)
      .get(`/api/creator-earnings/${FARMER_ADDRESS}/lifetime`)
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.lifetime_earned_xlm).toBe(12.3);
  });
});

describe('POST /api/creator-earnings/:address/claim — idempotency (#1027)', () => {
  test('400 if X-Idempotency-Key header is missing', async () => {
    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_idempotency_key');
  });

  test('400 if X-Idempotency-Key is not a valid UUID v4', async () => {
    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_idempotency_key');
  });

  test('400 if X-Idempotency-Key is a UUID v1 (not v4)', async () => {
    const uuidV1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', uuidV1);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_idempotency_key');
  });

  test('returns cached response on second request — no second on-chain call', async () => {
    const cachedBody = {
      success: true,
      tx_hash: 'CACHED_TX_HASH',
      claimed_xlm: 5,
      _status: 200,
    };
    getCachedResponse.mockResolvedValueOnce(cachedBody);

    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body.tx_hash).toBe('CACHED_TX_HASH');
    // invokeContract must NOT have been called
    expect(stellar.invokeContract).not.toHaveBeenCalled();
  });

  test('503 if idempotency cache throws on read', async () => {
    getCachedResponse.mockRejectedValueOnce(new Error('Redis unavailable'));

    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('idempotency_unavailable');
  });

  test("403 if the address belongs to a different farmer", async () => {
    getCachedResponse.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ ...farmerRow, id: 2 }], rowCount: 1 });

    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${otherFarmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);
    expect(res.status).toBe(403);
  });

  test('400 if the farmer has no Stellar key on file', async () => {
    getCachedResponse.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ ...farmerRow, stellar_secret_key: null }], rowCount: 1 });

    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_key');
  });

  test('200 — submits the claim and caches the response', async () => {
    getCachedResponse.mockResolvedValueOnce(null); // no prior cache
    mockQuery.mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 });
    stellar.invokeContract.mockResolvedValueOnce({ hash: 'CLAIM_TX_HASH', result: 50_000_000 });

    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tx_hash).toBe('CLAIM_TX_HASH');
    expect(res.body.claimed_xlm).toBe(5);
    // _status must NOT be in the client response
    expect(res.body._status).toBeUndefined();

    // cacheResponse must have been called with the key and the response
    expect(cacheResponse).toHaveBeenCalledWith(
      VALID_KEY,
      expect.objectContaining({ success: true, tx_hash: 'CLAIM_TX_HASH', _status: 200 }),
      86400,
    );

    expect(stellar.invokeContract).toHaveBeenCalledWith({
      contractId: process.env.SOROBAN_CREATOR_EARNINGS_CONTRACT_ID,
      method: 'claim',
      args: [
        { type: 'address', value: FARMER_ADDRESS },
        { type: 'address', value: process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID },
      ],
      signerSecret: farmerRow.stellar_secret_key,
    });
  });

  test('502 — claim failure is not cached, allows client retry', async () => {
    getCachedResponse.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 });
    stellar.invokeContract.mockRejectedValueOnce(new Error('Soroban transaction failed'));

    const res = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('claim_failed');
    expect(res.body.message).toMatch('Soroban transaction failed');
    // Error responses must NOT be cached
    expect(cacheResponse).not.toHaveBeenCalled();
  });

  test('only one on-chain submission occurs for duplicate idempotency key', async () => {
    // First call — no cache, performs on-chain call
    getCachedResponse.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [farmerRow], rowCount: 1 });
    stellar.invokeContract.mockResolvedValueOnce({ hash: 'TX_ONCE', result: 10_000_000 });

    const first = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);

    expect(first.status).toBe(200);
    expect(stellar.invokeContract).toHaveBeenCalledTimes(1);

    // Second call — cache returns the first result
    const cachedFirstResponse = {
      success: true,
      tx_hash: 'TX_ONCE',
      claimed_xlm: 1,
      _status: 200,
    };
    getCachedResponse.mockResolvedValueOnce(cachedFirstResponse);

    const second = await request(app)
      .post(`/api/creator-earnings/${FARMER_ADDRESS}/claim`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .set('X-Idempotency-Key', VALID_KEY);

    expect(second.status).toBe(200);
    expect(second.body.tx_hash).toBe('TX_ONCE');
    // invokeContract still only called once — no duplicate submission
    expect(stellar.invokeContract).toHaveBeenCalledTimes(1);
  });
});
