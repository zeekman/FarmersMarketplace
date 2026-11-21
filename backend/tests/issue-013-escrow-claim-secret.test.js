'use strict';

/**
 * Backlog 013 — Farmer escrow claim passes the encrypted secret key to Horizon.
 *
 * Secrets are stored encrypted at rest (scripts/encrypt-stellar-mnemonics.js),
 * so claimOrderBalance() must decrypt the farmer's secret before handing it to
 * the Stellar claim helper.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const { request, app, mockQuery } = require('./setup');
const { encrypt } = require('../src/utils/crypto');
const stellar = jest.requireMock('../src/utils/stellar');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

// A well-formed Stellar secret seed (S + 55 base32 chars).
const FARMER_SECRET = `S${'A'.repeat(55)}`;

const fundedDeliveredOrder = {
  id: 10,
  buyer_id: 1,
  product_id: 5,
  quantity: 2,
  total_price: 20,
  status: 'delivered',
  escrow_status: 'funded',
  escrow_balance_id: 'BALANCE_ID_001',
  farmer_id: 2,
  farmer_wallet: 'GFARMER',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
});

describe('POST /api/orders/:id/claim — encrypted farmer secret', () => {
  test('decrypts the stored secret and claims with the plaintext value', async () => {
    const encryptedSecret = await encrypt(FARMER_SECRET);
    expect(encryptedSecret).not.toBe(FARMER_SECRET);

    mockQuery
      .mockResolvedValueOnce({ rows: [fundedDeliveredOrder], rowCount: 1 }) // getFarmerOrder
      .mockResolvedValueOnce({ rows: [{ stellar_secret_key: encryptedSecret }], rowCount: 1 }) // secret lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE order

    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('CLAIM_TX_001');

    // claimBalance must receive the decrypted secret, never the ciphertext.
    expect(stellar.claimBalance).toHaveBeenCalledWith({
      claimantSecret: FARMER_SECRET,
      balanceId: 'BALANCE_ID_001',
    });

    // The raw encrypted value must never leak into the response.
    expect(JSON.stringify(res.body)).not.toContain(encryptedSecret);
  });
});

describe('static guard — no raw stellar_secret_key reaches a Stellar signing helper', () => {
  test('orders.js never forwards an encrypted/raw secret without decryptUserSecretKey', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'orders.js'),
      'utf8'
    );

    const signingParam = /(?:senderSecret|buyerSecret|claimantSecret|signerSecret|sourceSecret)\s*:/;
    const rawDbSecret = /_secret/;
    const hasDecrypt = /decryptUserSecretKey\(|(?:^|[^A-Za-z])decrypt\(/;

    const violations = source
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => signingParam.test(line) && rawDbSecret.test(line) && !hasDecrypt.test(line))
      .map(({ line, number }) => `${number}: ${line.trim()}`);

    expect(violations).toEqual([]);
  });
});
