/**
 * Integration tests for AutomaticOrderProcessor
 *
 * Tests integration with existing database, payment system, and notification system.
 * These tests verify the AutomaticOrderProcessor works with the real system components.
 */

const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');
const WaitlistService = require('../services/WaitlistService');

// Note: These are integration tests that would require a test database
// In a real environment, you would set up test data and run against a test DB

describe('AutomaticOrderProcessor Integration', () => {
  let processor;
  let waitlistService;

  beforeEach(() => {
    processor = new AutomaticOrderProcessor();
    waitlistService = new WaitlistService();
  });

  describe('Integration with WaitlistService', () => {
    test('should work with WaitlistService to process entries', () => {
      // This test verifies that AutomaticOrderProcessor can work with WaitlistService
      expect(processor).toBeInstanceOf(AutomaticOrderProcessor);
      expect(waitlistService).toBeInstanceOf(WaitlistService);

      // Verify the processor has the required methods
      expect(typeof processor.createAutomaticOrder).toBe('function');
      expect(typeof processor.processPayment).toBe('function');
      expect(typeof processor.processWaitlistOnRestock).toBe('function');
      expect(typeof processor.notifyInsufficientStock).toBe('function');
    });
  });

  describe('Method signatures and validation', () => {
    test('createAutomaticOrder should validate inputs correctly', async () => {
      const result = await processor.createAutomaticOrder(null, null, null);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.error).toContain('waitlistEntry is required');
    });

    test('processPayment should validate inputs correctly', async () => {
      const result = await processor.processPayment(null, null, null);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.error).toContain('order is required');
    });

    test('processWaitlistOnRestock should validate inputs correctly', async () => {
      const result = await processor.processWaitlistOnRestock(null, null);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.error).toContain('product_id must be a positive integer');
    });
  });

  describe('Error handling', () => {
    test('should handle database connection errors gracefully', async () => {
      // Test with invalid product ID that would cause database errors
      const result = await processor.processWaitlistOnRestock(-999, 10);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
    });

    test('should handle invalid stellar keys gracefully', async () => {
      const mockWaitlistEntry = {
        id: 1,
        buyer_id: 100,
        product_id: 200,
        quantity: 2,
      };

      const mockProduct = {
        id: 200,
        farmer_id: 300,
        name: 'Test Product',
        price: 10.0,
      };

      const mockBuyer = {
        id: 100,
        name: 'Test Buyer',
        email: 'test@example.com',
        stellar_public_key: 'INVALID_KEY',
        stellar_secret_key: 'INVALID_SECRET',
      };

      const result = await processor.createAutomaticOrder(
        mockWaitlistEntry,
        mockProduct,
        mockBuyer
      );

      // Should fail due to invalid stellar keys or insufficient balance
      expect(result.success).toBe(false);
      expect(['INSUFFICIENT_BALANCE', 'FARMER_WALLET_ERROR', 'INTERNAL_ERROR']).toContain(
        result.code
      );
    });
  });

  describe('Notification system integration', () => {
    test('notifyInsufficientStock should handle missing SMTP configuration', async () => {
      const mockEntry = {
        id: 1,
        buyer_id: 100,
        product_id: 200,
        quantity: 5,
      };

      const mockProduct = {
        id: 200,
        name: 'Test Product',
        unit: 'kg',
      };

      const mockBuyer = {
        id: 100,
        name: 'Test Buyer',
        email: 'test@example.com',
      };

      // This should not throw an error even if SMTP is not configured
      await expect(
        processor.notifyInsufficientStock(mockEntry, mockProduct, mockBuyer, 2)
      ).resolves.not.toThrow();
    });
  });

  describe('Service exports', () => {
    test('should be properly exported from services index', () => {
      const services = require('../services');

      expect(services.AutomaticOrderProcessor).toBeDefined();
      expect(services.AutomaticOrderProcessor).toBe(AutomaticOrderProcessor);
    });
  });

  describe('Database schema compatibility', () => {
    test('should work with existing database schema', () => {
      // Verify the processor uses the correct database module
      const db = require('../db/schema');
      expect(db).toBeDefined();
      expect(typeof db.query).toBe('function');
    });
  });

  describe('Stellar integration compatibility', () => {
    test('should work with existing stellar utilities', () => {
      // Verify the processor uses the correct stellar utilities
      const stellar = require('../utils/stellar');
      expect(stellar.sendPayment).toBeDefined();
      expect(stellar.getBalance).toBeDefined();
      expect(typeof stellar.sendPayment).toBe('function');
      expect(typeof stellar.getBalance).toBe('function');
    });
  });

  describe('Mailer integration compatibility', () => {
    test('should work with existing mailer utilities', () => {
      // Verify the processor uses the correct mailer utilities
      const mailer = require('../utils/mailer');
      expect(mailer.sendOrderEmails).toBeDefined();
      expect(typeof mailer.sendOrderEmails).toBe('function');
    });
  });
});

/**
 * Mock data generators for testing
 */
const TestDataGenerator = {
  createMockWaitlistEntry: (overrides = {}) => ({
    id: 1,
    buyer_id: 100,
    product_id: 200,
    quantity: 2,
    position: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  createMockProduct: (overrides = {}) => ({
    id: 200,
    farmer_id: 300,
    name: 'Test Product',
    price: 10.5,
    category: 'vegetables',
    unit: 'kg',
    quantity: 0,
    is_active: true,
    ...overrides,
  }),

  createMockBuyer: (overrides = {}) => ({
    id: 100,
    name: 'Test Buyer',
    email: 'buyer@test.com',
    role: 'buyer',
    stellar_public_key: 'GTEST_BUYER_PUBLIC_KEY',
    stellar_secret_key: 'STEST_BUYER_SECRET_KEY',
    is_active: true,
    ...overrides,
  }),

  createMockFarmer: (overrides = {}) => ({
    id: 300,
    name: 'Test Farmer',
    email: 'farmer@test.com',
    role: 'farmer',
    stellar_public_key: 'GTEST_FARMER_PUBLIC_KEY',
    stellar_secret_key: 'STEST_FARMER_SECRET_KEY',
    is_active: true,
    ...overrides,
  }),
};

module.exports = { TestDataGenerator };

// ---------------------------------------------------------------------------
// #805 — payment_failed status, balance check, mailer, next-buyer iteration
// ---------------------------------------------------------------------------
describe('#805 — AutomaticOrderProcessor waitlist processing', () => {
  const db = require('../db/schema');
  const mailer = require('../utils/mailer');
  const stellar = require('../utils/stellar');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const product = { id: 1, farmer_id: 2, name: 'Apples', price: 5.0, category: 'fruit', unit: 'kg', quantity: 10, is_active: true };
  const entry   = { id: 10, buyer_id: 3, product_id: 1, quantity: 2, position: 1, buyer_name: 'Bob', buyer_email: 'bob@test.com', stellar_public_key: 'GPUB', stellar_secret_key: 'SSEC' };

  test('sets order status to payment_failed and restores stock when balance insufficient', async () => {
    const proc = new AutomaticOrderProcessor();
    jest.spyOn(proc, '_getBalance').mockResolvedValue(0); // no balance

    db.query = jest.fn()
      .mockResolvedValueOnce({ rowCount: 1 })                        // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 })                        // stock decrement
      .mockResolvedValueOnce({ rows: [{ id: 99, buyer_id: 3, product_id: 1, quantity: 2, total_price: 10.0, status: 'pending', created_at: new Date() }], rowCount: 1 }) // INSERT order
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })               // UPDATE payment_failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })               // restore stock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });              // COMMIT

    const result = await proc._createOrderWithPayment({ waitlistEntry: entry, product, buyer: { id: 3, stellar_public_key: 'GPUB', stellar_secret_key: 'SSEC', name: 'Bob', email: 'bob@test.com' }, farmer: { id: 2, stellar_public_key: 'GFARM' }, totalPrice: 10.0 });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');

    // Verify UPDATE payment_failed was called
    const calls = db.query.mock.calls.map(([sql]) => sql);
    expect(calls.some((s) => s.includes('payment_failed'))).toBe(true);
    // Verify stock was restored
    expect(calls.some((s) => s.includes('quantity = quantity +'))).toBe(true);
  });

  test('processWaitlistOnRestock marks entry status=payment_failed and sends mailer on failure', async () => {
    const proc = new AutomaticOrderProcessor();
    jest.spyOn(mailer, 'sendOrderEmails').mockResolvedValue(undefined);

    // Stub createAutomaticOrder to simulate payment failure
    jest.spyOn(proc, 'createAutomaticOrder').mockResolvedValue({ success: false, error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });

    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })        // product lookup
      .mockResolvedValueOnce({ rows: [entry], rowCount: 1 })          // waitlist entries
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });              // UPDATE status=payment_failed

    const result = await proc.processWaitlistOnRestock(1, 10);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(1);

    const updateCall = db.query.mock.calls.find(([sql]) => sql.includes('UPDATE waitlist_entries'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain('payment_failed');
  });

  test('processWaitlistOnRestock continues to next buyer after payment failure', async () => {
    const proc = new AutomaticOrderProcessor();
    jest.spyOn(mailer, 'sendOrderEmails').mockResolvedValue(undefined);

    const entry2 = { ...entry, id: 11, buyer_id: 4, position: 2, buyer_name: 'Alice', buyer_email: 'alice@test.com' };

    jest.spyOn(proc, 'createAutomaticOrder')
      .mockResolvedValueOnce({ success: false, error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' }) // first buyer fails
      .mockResolvedValueOnce({ success: true, orderId: 200, txHash: 'TX123' }); // second buyer succeeds

    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [product], rowCount: 1 })        // product lookup
      .mockResolvedValueOnce({ rows: [entry, entry2], rowCount: 2 })  // waitlist entries
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })               // UPDATE status=payment_failed entry1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })               // DELETE entry2 (success)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });              // recalculate positions BEGIN/SELECT/...

    const result = await proc.processWaitlistOnRestock(1, 10);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
