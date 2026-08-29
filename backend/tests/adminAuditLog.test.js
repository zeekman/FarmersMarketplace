'use strict';

/**
 * Tests for the admin audit log feature (#1028).
 *
 * Covers:
 *   - GET /api/admin/audit-log endpoint (auth, filtering, pagination)
 *   - writeAuditLog utility (writes correct row, non-fatal on DB error)
 *   - Audit entries created by ban/unban, dispute resolve, contract simulate
 */

const { request, app, mockQuery } = require('./setup');
const jwt = require('jsonwebtoken');

// Expose writeAuditLog for unit tests (db is mocked globally by jest.setup.js)
jest.mock('../src/utils/auditLog', () => {
  const original = jest.requireActual('../src/utils/auditLog');
  return {
    ...original,
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
});
const { writeAuditLog } = require('../src/utils/auditLog');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const adminToken = jwt.sign({ id: 99, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

const sampleEntry = {
  id: 1,
  admin_id: 99,
  action: 'ban_user',
  target_type: 'user',
  target_id: '42',
  before_val: JSON.stringify({ banned_at: null }),
  after_val: JSON.stringify({ banned_at: '2026-07-29T00:00:00.000Z' }),
  created_at: '2026-07-29T00:00:00.000Z',
  admin_name: 'Admin User',
  admin_email: 'admin@example.com',
};

beforeEach(() => {
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  writeAuditLog.mockClear();
});

// ─── GET /api/admin/audit-log ──────────────────────────────────────────────

describe('GET /api/admin/audit-log', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/audit-log');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns paginated audit log entries for admin', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [sampleEntry], rowCount: 1 }) // data query
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 }); // count query

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].action).toBe('ban_user');
    expect(res.body.entries[0].before).toEqual({ banned_at: null });
    expect(res.body.entries[0].after).toEqual({ banned_at: '2026-07-29T00:00:00.000Z' });
    expect(res.body.pagination).toMatchObject({ page: 1, total: 1 });
  });

  it('passes filter params to the query', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await request(app)
      .get('/api/admin/audit-log?admin_id=99&target_type=user&target_id=42&from=2026-01-01&to=2026-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Verify the DB query was called with the filter values
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain(99);       // admin_id
    expect(callArgs[1]).toContain('user');   // target_type
    expect(callArgs[1]).toContain('42');     // target_id
  });

  it('returns empty entries when no audit records match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });
});

// ─── writeAuditLog unit tests ─────────────────────────────────────────────

describe('writeAuditLog utility', () => {
  // Use the real implementation for these unit tests
  let realWriteAuditLog;
  const db = require('../src/db/schema');

  beforeAll(() => {
    // Get the actual (unmocked) implementation
    jest.unmock('../src/utils/auditLog');
    realWriteAuditLog = jest.requireActual('../src/utils/auditLog').writeAuditLog;
  });

  afterAll(() => {
    // Restore mock for subsequent describe blocks
    jest.mock('../src/utils/auditLog', () => ({
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    }));
  });

  it('writes correct row to admin_audit_log', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await realWriteAuditLog({
      adminId: 99,
      action: 'ban_user',
      targetType: 'user',
      targetId: 42,
      before: { banned_at: null },
      after: { banned_at: '2026-07-29' },
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log'),
      expect.arrayContaining([
        99,
        'ban_user',
        'user',
        '42',
        JSON.stringify({ banned_at: null }),
        JSON.stringify({ banned_at: '2026-07-29' }),
      ]),
    );
  });

  it('is non-fatal — does not throw when DB query fails', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection lost'));

    // Should resolve without throwing
    await expect(
      realWriteAuditLog({
        adminId: 99,
        action: 'ban_user',
        targetType: 'user',
        targetId: 1,
      })
    ).resolves.toBeUndefined();
  });

  it('serialises before/after as JSON strings', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await realWriteAuditLog({
      adminId: 1,
      action: 'resolve_dispute',
      targetType: 'dispute',
      targetId: '7',
      before: { status: 'open' },
      after: { status: 'resolved', resolution: 'buyer' },
    });

    const callParams = db.query.mock.calls[0][1];
    expect(JSON.parse(callParams[4])).toEqual({ status: 'open' });
    expect(JSON.parse(callParams[5])).toEqual({ status: 'resolved', resolution: 'buyer' });
  });

  it('stores null for missing before/after', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await realWriteAuditLog({
      adminId: 1,
      action: 'contract_simulate',
      targetType: 'contract',
      targetId: 'CABC',
    });

    const callParams = db.query.mock.calls[0][1];
    expect(callParams[4]).toBeNull(); // before_val
    expect(callParams[5]).toBeNull(); // after_val
  });
});

// ─── Audit entry created by dispute resolve ───────────────────────────────

describe('Dispute resolve — writes audit entry', () => {
  const stellar = jest.requireMock('../src/utils/stellar');

  it('calls writeAuditLog after resolving a dispute', async () => {
    const disputeRow = {
      id: 5,
      order_id: 10,
      buyer_id: 2,
      farmer_id: 3,
      status: 'open',
      total_price: '10',
      product_id: 1,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [disputeRow], rowCount: 1 })   // fetch dispute
      .mockResolvedValueOnce({ rows: [{ id: 2, stellar_public_key: 'GPUB2', stellar_secret_key: 'SSEC2' }], rowCount: 1 }) // buyer
      .mockResolvedValueOnce({ rows: [{ id: 3, stellar_public_key: 'GPUB3', stellar_secret_key: 'SSEC3' }], rowCount: 1 }) // farmer
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: 'ADMINSEC' }], rowCount: 1 }) // admin key
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })             // UPDATE disputes
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'P' }], rowCount: 1 }); // product

    stellar.invokeEscrowContract.mockResolvedValue({ txHash: 'TX' });

    const res = await request(app)
      .patch('/api/disputes/5/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'buyer' });

    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 99,
        action: 'resolve_dispute',
        targetType: 'dispute',
        targetId: 5,
      }),
    );
  });
});

// ─── Audit entry created by contract simulate ────────────────────────────

describe('Contract simulate — writes audit entry', () => {
  const stellar = jest.requireMock('../src/utils/stellar');

  const VALID_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  it('calls writeAuditLog after simulating a contract call', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ contract_id: VALID_CONTRACT_ID, network: 'testnet' }], rowCount: 1 }) // contracts_registry
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // logInvocation insert

    stellar.simulateContractCall.mockResolvedValueOnce({
      success: true,
      fee: '100',
      result: 'ok',
      error: null,
    });

    const res = await request(app)
      .post(`/api/contracts/${VALID_CONTRACT_ID}/simulate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ method: 'balance', args: [] });

    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 99,
        action: 'contract_simulate',
        targetType: 'contract',
        targetId: VALID_CONTRACT_ID,
      }),
    );
  });
});
