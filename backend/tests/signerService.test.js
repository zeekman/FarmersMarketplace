'use strict';

/**
 * SignerService & Custodial Key Centralisation Test Suite
 *
 * Verifies Acceptance Criteria from Backlog 025:
 * 1. No route module selects stellar_secret_key (grep / static test).
 * 2. All payment, refund, claim, trustline, merge and cooperative signing goes through signerService.
 * 3. Audit rows are written for every signature, viewable via existing audit log route.
 * 4. Unit tests with a fake keystore.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const StellarSdk = require('@stellar/stellar-sdk');
const { request, app, mockDb } = require('./setup');
const signerService = require('../src/services/signerService');
const { SignerService, FakeKeystore, DefaultKeystore } = signerService;

const TEST_SECRET = 'SDJ7W6W2RFL24P7GZZK4M3YV4M3YV4M3YV4M3YV4M3YV4M3YV4M3YV4M';
const TEST_KEYPAIR = StellarSdk.Keypair.random();
const SECRET_KEY = TEST_KEYPAIR.secret();
const PUBLIC_KEY = TEST_KEYPAIR.publicKey();

describe('Acceptance Criteria 1: No route module selects stellar_secret_key', () => {
  const routesDir = path.join(__dirname, '../src/routes');
  const routeFiles = fs
    .readdirSync(routesDir)
    .filter((file) => file.endsWith('.js'));

  test('all route files are found', () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  routeFiles.forEach((file) => {
    test(`route file "${file}" does not select stellar_secret_key in any SQL query`, () => {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8');

      // Check for SQL SELECT containing stellar_secret_key
      const selectSecretKeyRegex = /\bSELECT\b[\s\S]*?\bstellar_secret_key\b/i;
      expect(content).not.toMatch(selectSecretKeyRegex);

      // Check for inline decryptUserSecretKey calls
      expect(content).not.toContain('decryptUserSecretKey');

      // Check that stellar_secret_key only appears in INSERT (auth/cooperatives) or UPDATE NULL (wallet merge)
      if (!['auth.js', 'cooperatives.js', 'wallet.js'].includes(file)) {
        expect(content).not.toContain('stellar_secret_key');
      }
    });
  });
});

describe('SignerService unit tests with FakeKeystore', () => {
  let fakeKeystore;
  let service;
  let mockServer;

  beforeEach(() => {
    fakeKeystore = new FakeKeystore({
      101: { secretKey: SECRET_KEY, publicKey: PUBLIC_KEY },
      102: { secretKey: SECRET_KEY, publicKey: PUBLIC_KEY },
      coop_5: { secretKey: SECRET_KEY, publicKey: PUBLIC_KEY },
    });

    mockServer = {
      submitTransaction: jest.fn().mockResolvedValue({ hash: 'TX_SUBMITTED_HASH_123' }),
      loadAccount: jest.fn().mockResolvedValue(
        new StellarSdk.Account(PUBLIC_KEY, '100')
      ),
    };

    service = new SignerService({
      keystore: fakeKeystore,
      serverInstance: mockServer,
      networkPassphraseStr: StellarSdk.Networks.TESTNET,
      database: mockDb,
    });

    mockDb.query.mockReset();
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  test('loads key from fake keystore, executes buildTx, signs, submits and audits', async () => {
    let capturedInBuild = null;

    const result = await service.signAndSubmit({
      userId: 101,
      purpose: 'test_payment',
      requestId: 'req-abc-123',
      buildTx: async ({ keypair, secretKey, publicKey }) => {
        capturedInBuild = { secretKey, publicKey };
        return { txHash: 'CUSTOM_TX_HASH_999', customField: 'hello' };
      },
    });

    // Verification: buildTx was executed with key data
    expect(capturedInBuild.secretKey).toBe(SECRET_KEY);
    expect(capturedInBuild.publicKey).toBe(PUBLIC_KEY);

    // Verification: result contains txHash and non-secret fields
    expect(result.txHash).toBe('CUSTOM_TX_HASH_999');
    expect(result.customField).toBe('hello');
    // Secret key is NEVER returned in result
    expect(result.secretKey).toBeUndefined();
    expect(result.senderSecret).toBeUndefined();

    // Verification: audit row was written with correct parameters
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log'),
      expect.arrayContaining([
        101,
        'test_payment',
        'signature',
        'CUSTOM_TX_HASH_999',
        null,
        expect.stringContaining('"user_id":101'),
        null,
        null,
        'req-abc-123',
      ])
    );
  });

  test('submits and signs a StellarSdk.Transaction built by buildTx callback', async () => {
    const account = new StellarSdk.Account(PUBLIC_KEY, '100');
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: StellarSdk.Keypair.random().publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: '10',
        })
      )
      .setTimeout(30)
      .build();

    const signSpy = jest.spyOn(tx, 'sign');

    const result = await service.signAndSubmit({
      userId: 101,
      purpose: 'order_payment',
      buildTx: async () => tx,
    });

    expect(signSpy).toHaveBeenCalled();
    expect(mockServer.submitTransaction).toHaveBeenCalledWith(tx);
    expect(result.txHash).toBe('TX_SUBMITTED_HASH_123');
    expect(result.secretKey).toBeUndefined();
  });

  test('signs on behalf of a cooperative with cooperativeId', async () => {
    const result = await service.signAndSubmit({
      cooperativeId: 5,
      userId: 101,
      purpose: 'cooperative_direct_payment',
      buildTx: async () => 'COOP_TX_HASH',
    });

    expect(result.txHash).toBe('COOP_TX_HASH');
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log'),
      expect.arrayContaining([101, 'cooperative_direct_payment', 'signature', 'COOP_TX_HASH'])
    );
  });

  test('throws when neither userId nor cooperativeId is provided', async () => {
    await expect(
      service.signAndSubmit({
        purpose: 'payment',
        buildTx: async () => 'tx',
      })
    ).rejects.toThrow(/userId or cooperativeId is required/);
  });

  test('throws when purpose is missing', async () => {
    await expect(
      service.signAndSubmit({
        userId: 101,
        buildTx: async () => 'tx',
      })
    ).rejects.toThrow(/purpose string is required/);
  });

  test('throws when buildTx callback is missing or not a function', async () => {
    await expect(
      service.signAndSubmit({
        userId: 101,
        purpose: 'payment',
      })
    ).rejects.toThrow(/buildTx callback is required/);
  });

  test('throws when user key is not found in keystore', async () => {
    await expect(
      service.signAndSubmit({
        userId: 99999,
        purpose: 'payment',
        buildTx: async () => 'tx',
      })
    ).rejects.toThrow(/Custodial key not found/);
  });

  test('extracts request_id, ip, and user-agent from req object', async () => {
    const fakeReq = {
      requestId: 'req-from-object',
      ip: '192.168.1.1',
      get: (header) => (header.toLowerCase() === 'user-agent' ? 'Jest/TestRunner' : null),
      headers: { 'user-agent': 'Jest/TestRunner' },
    };

    await service.signAndSubmit({
      userId: 101,
      purpose: 'wallet_withdrawal',
      req: fakeReq,
      buildTx: async () => 'WITHDRAW_TX_1',
    });

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log'),
      expect.arrayContaining([
        101,
        'wallet_withdrawal',
        'signature',
        'WITHDRAW_TX_1',
        null,
        expect.stringContaining('"request_id":"req-from-object"'),
        '192.168.1.1',
        'Jest/TestRunner',
        'req-from-object',
      ])
    );
  });

  test('setKeystore allows swapping keystores', async () => {
    const dynamicKeystore = new FakeKeystore({
      200: { secretKey: SECRET_KEY, publicKey: PUBLIC_KEY },
    });
    service.setKeystore(dynamicKeystore);

    const result = await service.signAndSubmit({
      userId: 200,
      purpose: 'custom_action',
      buildTx: async () => 'DYNAMIC_TX',
    });

    expect(result.txHash).toBe('DYNAMIC_TX');
  });
});

describe('Acceptance Criteria 3: Admin can view signature audit rows via existing audit log route', () => {
  const adminSecret = process.env.JWT_SECRET || 'test-secret-for-jest';
  const adminToken = jwt.sign({ id: 99, role: 'admin' }, adminSecret);

  beforeEach(() => {
    mockDb.query.mockReset();
  });

  test('GET /api/admin/audit-log returns signature audit entries', async () => {
    const auditRows = [
      {
        id: 1,
        admin_id: 2,
        action: 'order_payment',
        target_type: 'signature',
        target_id: 'TX_SIGN_HASH_001',
        before_val: null,
        after_val: JSON.stringify({ user_id: 2, purpose: 'order_payment', tx_hash: 'TX_SIGN_HASH_001', request_id: 'req-1' }),
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
        request_id: 'req-1',
        created_at: '2026-11-19T12:00:00Z',
        admin_name: 'Buyer Bob',
        admin_email: 'bob@example.com',
      },
    ];

    // mockDb.query returns audit log rows and count
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 }) // requireAdmin user active check
      .mockResolvedValueOnce({ rows: auditRows, rowCount: 1 })         // data query
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 }); // count query

    const res = await request(app)
      .get('/api/admin/audit-log?target_type=signature')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].action).toBe('order_payment');
    expect(res.body.entries[0].target_type).toBe('signature');
    expect(res.body.entries[0].target_id).toBe('TX_SIGN_HASH_001');
    expect(res.body.entries[0].after).toEqual({
      user_id: 2,
      purpose: 'order_payment',
      tx_hash: 'TX_SIGN_HASH_001',
      request_id: 'req-1',
    });
  });

  test('GET /api/admin/audit-log filters by user_id alias', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ active: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await request(app)
      .get('/api/admin/audit-log?user_id=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('a.admin_id = 1'),
      expect.arrayContaining([2, 50, 0])
    );
  });
});
