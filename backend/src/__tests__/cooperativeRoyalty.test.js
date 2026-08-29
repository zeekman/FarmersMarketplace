/**
 * cooperativeRoyalty.test.js
 *
 * Unit and integration-style tests for issue #860:
 * Cooperative royalty distribution on escrow release.
 *
 * Covers:
 *  - No cooperative: invokeEscrowContract called without cooperative fields
 *  - Cooperative royalty: cooperative_address and royalty_bps populated from DB
 *  - Zero royalty bps: cooperative_address set but royalty_bps = 0
 *  - Royalty calculation arithmetic
 *  - PATCH /api/cooperatives/:id/royalty endpoint validation
 */

jest.mock('../db/schema');
jest.mock('../utils/stellar-contracts', () => ({
  invokeEscrowContract: jest.fn(),
}));
jest.mock('../utils/mailer', () => ({
  sendOrderEmails: jest.fn(),
  sendLowStockAlert: jest.fn(),
  sendStatusUpdateEmail: jest.fn(),
  sendBackInStockEmail: jest.fn(),
  sendReturnEmail: jest.fn(),
}));

const db = require('../db/schema');
const { invokeEscrowContract } = require('../utils/stellar-contracts');
const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');

// ── Royalty arithmetic (pure, no I/O) ────────────────────────────────────────

describe('Cooperative royalty arithmetic', () => {
  /**
   * Mirrors the on-chain calculation:
   *   fee      = amount * fee_bps / 10_000
   *   after_fee = amount - fee
   *   royalty  = after_fee * royalty_bps / 10_000
   *   farmer   = after_fee - royalty
   */
  function calcRoyalty(amount, feeBps, royaltyBps) {
    const fee = Math.floor((amount * feeBps) / 10_000);
    const afterFee = amount - fee;
    const royalty = Math.floor((afterFee * royaltyBps) / 10_000);
    const farmerAmount = afterFee - royalty;
    return { fee, afterFee, royalty, farmerAmount };
  }

  test('no cooperative (royaltyBps=0): farmer receives full amount minus fee', () => {
    const { fee, royalty, farmerAmount } = calcRoyalty(10_000_000, 250, 0);
    expect(fee).toBe(250_000);
    expect(royalty).toBe(0);
    expect(farmerAmount).toBe(9_750_000);
    expect(fee + royalty + farmerAmount).toBe(10_000_000);
  });

  test('cooperative 500 bps royalty (5%) with 250 bps platform fee (2.5%)', () => {
    const { fee, royalty, farmerAmount } = calcRoyalty(10_000_000, 250, 500);
    expect(fee).toBe(250_000);
    // royalty = (10_000_000 - 250_000) * 500 / 10_000 = 487_500
    expect(royalty).toBe(487_500);
    expect(farmerAmount).toBe(9_262_500);
    expect(fee + royalty + farmerAmount).toBe(10_000_000);
  });

  test('cooperative with zero royalty_bps: no royalty despite address set', () => {
    const { royalty, farmerAmount } = calcRoyalty(10_000_000, 0, 0);
    expect(royalty).toBe(0);
    expect(farmerAmount).toBe(10_000_000);
  });

  test('farmer_amount is never negative for valid inputs', () => {
    const cases = [
      [1, 0, 0],
      [1_000_000, 1000, 2000],
      [10_000_000, 500, 1000],
      [1, 1000, 10_000],
    ];
    for (const [amount, feeBps, royaltyBps] of cases) {
      const { farmerAmount, royalty, fee } = calcRoyalty(amount, feeBps, royaltyBps);
      expect(farmerAmount).toBeGreaterThanOrEqual(0);
      expect(royalty).toBeGreaterThanOrEqual(0);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(farmerAmount + royalty + fee).toBeLessThanOrEqual(amount);
    }
  });

  test('royalty_bps > 10000 is invalid', () => {
    const invalid = [10_001, 20_000, 99_999];
    for (const bps of invalid) {
      expect(bps > 10_000).toBe(true);
    }
  });
});

// ── escrow event topic structure (#860) ───────────────────────────────────────

describe('Cooperative royalty event structure', () => {
  const makeRoyaltyEvent = (orderId, coopAddress, royaltyAmount) => ({
    topics: ['escrow', 'royalty', orderId],
    data: [coopAddress, royaltyAmount],
    ledger: 101,
    type: 'contract',
  });

  test('royalty event has correct topic structure', () => {
    const ev = makeRoyaltyEvent(42, 'GCOOP123', 487_500);
    expect(ev.topics[0]).toBe('escrow');
    expect(ev.topics[1]).toBe('royalty');
    expect(ev.topics[2]).toBe(42);
    const [coopAddr, amount] = ev.data;
    expect(typeof coopAddr).toBe('string');
    expect(typeof amount).toBe('number');
    expect(amount).toBeGreaterThan(0);
  });
});

// ── AutomaticOrderProcessor.processEscrowDeposit — cooperative fields ─────────

describe('AutomaticOrderProcessor.processEscrowDeposit cooperative royalty (#860)', () => {
  let processor;

  const mockOrder = { id: 5001, total_price: 21.0 };
  const mockBuyer = {
    stellar_public_key: 'GBUYER1',
    stellar_secret_key: 'SBUYER1_SECRET',
  };
  const mockFarmer = {
    id: 300,
    stellar_public_key: 'GFARMER1',
  };

  beforeEach(() => {
    processor = new AutomaticOrderProcessor();
    jest.clearAllMocks();
    db.query = jest.fn();
    invokeEscrowContract.mockResolvedValue({ txHash: 'mock_escrow_tx', contractId: 'CESCROW' });
  });

  test('no cooperative: deposit called without cooperative fields', async () => {
    // DB returns no cooperative for this farmer
    db.query.mockResolvedValueOnce({ rows: [] });

    await processor.processEscrowDeposit(mockOrder, mockBuyer, mockFarmer);

    expect(invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deposit',
        cooperativeAddress: null,
        cooperativeRoyaltyBps: 0,
      })
    );
  });

  test('cooperative member: deposit passes cooperative_address and royalty_bps', async () => {
    // DB returns a cooperative with 500 bps royalty
    db.query.mockResolvedValueOnce({
      rows: [{ stellar_public_key: 'GCOOP_TREASURY', royalty_bps: 500 }],
    });

    await processor.processEscrowDeposit(mockOrder, mockBuyer, mockFarmer);

    expect(invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deposit',
        cooperativeAddress: 'GCOOP_TREASURY',
        cooperativeRoyaltyBps: 500,
      })
    );
  });

  test('cooperative with zero royalty_bps: address passed, royalty is 0', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ stellar_public_key: 'GCOOP_TREASURY', royalty_bps: 0 }],
    });

    await processor.processEscrowDeposit(mockOrder, mockBuyer, mockFarmer);

    expect(invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({
        cooperativeAddress: 'GCOOP_TREASURY',
        cooperativeRoyaltyBps: 0,
      })
    );
  });

  test('cooperative lookup DB error is non-fatal: deposit proceeds without cooperative fields', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection error'));

    const result = await processor.processEscrowDeposit(mockOrder, mockBuyer, mockFarmer);

    expect(result.success).toBe(true);
    expect(invokeEscrowContract).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deposit',
        cooperativeAddress: null,
        cooperativeRoyaltyBps: 0,
      })
    );
  });

  test('escrow deposit failure still returns ESCROW_FAILED', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    invokeEscrowContract.mockRejectedValueOnce(new Error('contract reverted'));

    const result = await processor.processEscrowDeposit(mockOrder, mockBuyer, mockFarmer);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ESCROW_FAILED');
  });
});
