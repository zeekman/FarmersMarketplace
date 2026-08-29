/**
 * Unit tests for routes/paymentStreams.js — continuous Stellar payment streaming
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

const mockDb = jest.requireMock('../db/schema');
const stellar = jest.requireMock('../utils/stellar');

const senderToken = jwt.sign({ id: 1, role: 'farmer' }, process.env.JWT_SECRET);
const recipientToken = jwt.sign({ id: 2, role: 'buyer' }, process.env.JWT_SECRET);
const outsiderToken = jwt.sign({ id: 3, role: 'buyer' }, process.env.JWT_SECRET);

const VALID_CONTRACT_ID = 'C'.padEnd(56, 'A'); // 56 character contract ID
const SENDER_ADDRESS = 'GSENDER123';
const RECIPIENT_ADDRESS = 'GRECIPIENT456';

describe('POST /api/paymentStreams', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('creates a payment stream successfully', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        stellar_public_key: SENDER_ADDRESS,
        stellar_secret_key: 'SSENDER_SECRET',
      }],
      rowCount: 1,
    });

    stellar.invokeContract.mockResolvedValueOnce({
      hash: 'STREAM_CREATE_TX',
      result: { stream_id: 1 },
    });

    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('STREAM_CREATE_TX');
  });

  it('returns 400 for invalid contract_id format', async () => {
    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: 'invalid',
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_contract_id');
  });

  it('returns 400 for invalid recipient address', async () => {
    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: 'INVALID',
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_recipient');
  });

  it('returns 400 for non-positive rate_per_second', async () => {
    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rate_per_second must be a positive number/i);
  });

  it('returns 400 for non-positive deposit', async () => {
    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.001,
        deposit: -10,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deposit must be a positive number/i);
  });

  it('returns 400 for end_time in the past', async () => {
    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) - 3600,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end_time must be a future unix timestamp/i);
  });

  it('returns 400 when sender and recipient are the same', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        stellar_public_key: SENDER_ADDRESS,
        stellar_secret_key: 'SSECRET',
      }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: SENDER_ADDRESS, // Same as sender
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sender and recipient must differ/i);
  });

  it('returns 400 when user has no Stellar wallet', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 1, stellar_public_key: null, stellar_secret_key: null }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_wallet');
  });

  it('returns 502 when contract invocation fails', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        stellar_public_key: SENDER_ADDRESS,
        stellar_secret_key: 'SSECRET',
      }],
      rowCount: 1,
    });

    stellar.invokeContract.mockRejectedValueOnce(new Error('Contract error'));

    const res = await request(app)
      .post('/api/paymentStreams')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({
        contract_id: VALID_CONTRACT_ID,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.001,
        deposit: 100,
        end_time: Math.floor(Date.now() / 1000) + 86400,
      });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('contract_error');
  });
});

describe('GET /api/paymentStreams/:contractId/:streamId/accrued', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('returns accrued amount for stream participant', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, stellar_public_key: SENDER_ADDRESS }],
        rowCount: 1,
      });

    stellar.simulateContract.mockResolvedValueOnce({ accrued: '50.5' });

    const res = await request(app)
      .get(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/accrued`)
      .set('Authorization', `Bearer ${senderToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ accrued: '50.5' });
  });

  it('returns 403 when caller is not a stream participant', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 3, stellar_public_key: 'GOUTSIDER' }],
        rowCount: 1,
      });

    const res = await request(app)
      .get(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/accrued`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('returns 404 when stream not found', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get(`/api/paymentStreams/${VALID_CONTRACT_ID}/999/accrued`)
      .set('Authorization', `Bearer ${senderToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('stream_not_found');
  });

  it('returns 400 for invalid streamId', async () => {
    const res = await request(app)
      .get(`/api/paymentStreams/${VALID_CONTRACT_ID}/invalid/accrued`)
      .set('Authorization', `Bearer ${senderToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid streamId/i);
  });
});

describe('PATCH /api/paymentStreams/:contractId/:streamId/rate', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('decreases stream rate successfully (sender-only)', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
          rate_per_second: 0.01,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, stellar_public_key: SENDER_ADDRESS, stellar_secret_key: 'SSECRET' }],
        rowCount: 1,
      });

    stellar.invokeContract.mockResolvedValueOnce({
      hash: 'RATE_DECREASE_TX',
      result: {},
    });

    const res = await request(app)
      .patch(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/rate`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ new_rate: 0.005 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('RATE_DECREASE_TX');
  });

  it('returns 403 when recipient tries to decrease rate', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
          rate_per_second: 0.01,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 2, stellar_public_key: RECIPIENT_ADDRESS }],
        rowCount: 1,
      });

    const res = await request(app)
      .patch(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/rate`)
      .set('Authorization', `Bearer ${recipientToken}`)
      .send({ new_rate: 0.005 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only the stream sender can decrease the rate/i);
  });

  it('returns 400 when new_rate is not less than current rate', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        contract_id: VALID_CONTRACT_ID,
        stream_id: 1,
        sender: SENDER_ADDRESS,
        recipient: RECIPIENT_ADDRESS,
        rate_per_second: 0.01,
      }],
      rowCount: 1,
    });

    const res = await request(app)
      .patch(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/rate`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ new_rate: 0.02 }); // Higher than current

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/new_rate must be less than the current rate/i);
  });
});

describe('POST /api/paymentStreams/:contractId/:streamId/withdraw', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('allows recipient to withdraw accrued funds', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 2, stellar_public_key: RECIPIENT_ADDRESS, stellar_secret_key: 'SRECIPIENT_SECRET' }],
        rowCount: 1,
      });

    stellar.invokeContract.mockResolvedValueOnce({
      hash: 'WITHDRAW_TX',
      result: {},
    });

    const res = await request(app)
      .post(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/withdraw`)
      .set('Authorization', `Bearer ${recipientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('WITHDRAW_TX');
  });

  it('returns 403 when sender tries to withdraw', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, stellar_public_key: SENDER_ADDRESS }],
        rowCount: 1,
      });

    const res = await request(app)
      .post(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/withdraw`)
      .set('Authorization', `Bearer ${senderToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only the stream recipient can withdraw/i);
  });
});

describe('POST /api/paymentStreams/:contractId/:streamId/cancel', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('allows sender to cancel stream', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, stellar_public_key: SENDER_ADDRESS, stellar_secret_key: 'SSECRET' }],
        rowCount: 1,
      });

    stellar.invokeContract.mockResolvedValueOnce({
      hash: 'CANCEL_TX',
      result: {},
    });

    const res = await request(app)
      .post(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/cancel`)
      .set('Authorization', `Bearer ${senderToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('CANCEL_TX');
  });

  it('returns 403 when recipient tries to cancel', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          contract_id: VALID_CONTRACT_ID,
          stream_id: 1,
          sender: SENDER_ADDRESS,
          recipient: RECIPIENT_ADDRESS,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 2, stellar_public_key: RECIPIENT_ADDRESS }],
        rowCount: 1,
      });

    const res = await request(app)
      .post(`/api/paymentStreams/${VALID_CONTRACT_ID}/1/cancel`)
      .set('Authorization', `Bearer ${recipientToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only the stream sender can cancel/i);
  });
});
