/**
 * Unit tests for AutomaticOrderProcessor
 *
 * Tests the core functionality of automatic order creation and payment processing
 * for waitlist entries when products are restocked.
 */

const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');
const db = require('../db/schema');

// Mock the stellar utilities
jest.mock('../utils/stellar', () => ({
  sendPayment: jest.fn(),
  getBalance: jest.fn(),
}));

// Mock the mailer utilities
jest.mock('../utils/mailer', () => ({
  sendOrderEmails: jest.fn(),
}));

const { sendPayment, getBalance } = require('../utils/stellar');
const { sendOrderEmails } = require('../utils/mailer');

describe('AutomaticOrderProcessor', () => {
  let processor;

  beforeEach(() => {
    processor = new AutomaticOrderProcessor();
    jest.clearAllMocks();
  });

  describe('createAutomaticOrder', () => {
    const mockWaitlistEntry = {
      id: 1,
      buyer_id: 100,
      product_id: 200,
      quantity: 2,
      position: 1,
    };

    const mockProduct = {
      id: 200,
      farmer_id: 300,
      name: 'Test Product',
      price: 10.5,
      category: 'vegetables',
      unit: 'kg',
    };

    const mockBuyer = {
      id: 100,
      name: 'Test Buyer',
      email: 'buyer@test.com',
      stellar_public_key: 'GTEST_BUYER_KEY',
      stellar_secret_key: 'STEST_BUYER_SECRET',
    };

    const mockFarmer = {
      id: 300,
      name: 'Test Farmer',
      email: 'farmer@test.com',
      stellar_public_key: 'GTEST_FARMER_KEY',
    };

    beforeEach(() => {
      // Mock database queries
      db.query = jest.fn();

      // Default successful responses
      getBalance.mockResolvedValue(50.0); // Sufficient balance
      sendPayment.mockResolvedValue('mock_tx_hash_123');
      sendOrderEmails.mockResolvedValue();
    });

    test('should create automatic order successfully with valid inputs', async () => {
      // Mock database responses
      db.query
        .mockResolvedValueOnce({ rows: [mockFarmer] }) // Get farmer
        .mockResolvedValueOnce() // BEGIN transaction
        .mockResolvedValueOnce({ rowCount: 1 }) // Update stock
        .mockResolvedValueOnce({
          rows: [{ id: 1001, ...mockWaitlistEntry, total_price: 21.0, status: 'pending' }],
        }) // Insert order
        .mockResolvedValueOnce() // Update order with payment
        .mockResolvedValueOnce(); // COMMIT transaction

      const result = await processor.createAutomaticOrder(
        mockWaitlistEntry,
        mockProduct,
        mockBuyer
      );

      expect(result.success).toBe(true);
      expect(result.orderId).toBe(1001);
      expect(result.txHash).toBe('mock_tx_hash_123');
      expect(result.totalPrice).toBe(21.0);

      // Verify payment was processed
      expect(sendPayment).toHaveBeenCalledWith({
        senderSecret: mockBuyer.stellar_secret_key,
        receiverPublicKey: mockFarmer.stellar_public_key,
        amount: 21.0,
        memo: 'AutoOrder#1001',
      });

      // Verify notifications were sent
      expect(sendOrderEmails).toHaveBeenCalled();
    });

    test('should fail when buyer has insufficient balance', async () => {
      getBalance.mockResolvedValue(5.0); // Insufficient balance

      const result = await processor.createAutomaticOrder(
        mockWaitlistEntry,
        mockProduct,
        mockBuyer
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_BALANCE');
      expect(result.error).toContain('Insufficient XLM balance');
      expect(result.requiredBalance).toBe(21.00001);
      expect(result.availableBalance).toBe(5.0);
    });

    test('should fail when farmer wallet is not configured', async () => {
      const farmerWithoutWallet = { ...mockFarmer, stellar_public_key: null };

      db.query.mockResolvedValueOnce({ rows: [farmerWithoutWallet] });

      const result = await processor.createAutomaticOrder(
        mockWaitlistEntry,
        mockProduct,
        mockBuyer
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('FARMER_WALLET_ERROR');
      expect(result.error).toBe('Farmer wallet not configured');
    });

    test('should fail when insufficient stock is available', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockFarmer] }) // Get farmer
        .mockResolvedValueOnce() // BEGIN transaction
        .mockResolvedValueOnce({ rowCount: 0 }); // Update stock fails (no rows affected)

      const result = await processor.createAutomaticOrder(
        mockWaitlistEntry,
        mockProduct,
        mockBuyer
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_STOCK');
      expect(result.error).toBe('Insufficient stock available');
    });

    test('should handle payment failures gracefully', async () => {
      sendPayment.mockRejectedValue(new Error('Payment network error'));

      db.query
        .mockResolvedValueOnce({ rows: [mockFarmer] }) // Get farmer
        .mockResolvedValueOnce() // BEGIN transaction
        .mockResolvedValueOnce({ rowCount: 1 }) // Update stock
        .mockResolvedValueOnce({
          rows: [{ id: 1001, ...mockWaitlistEntry, total_price: 21.0, status: 'pending' }],
        }) // Insert order
        .mockResolvedValueOnce(); // ROLLBACK transaction

      const result = await processor.createAutomaticOrder(
        mockWaitlistEntry,
        mockProduct,
        mockBuyer
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('PAYMENT_FAILED');
      expect(result.error).toContain('Payment failed');
    });

    test('should validate input parameters', async () => {
      // Test with invalid waitlist entry
      const result1 = await processor.createAutomaticOrder(null, mockProduct, mockBuyer);
      expect(result1.success).toBe(false);
      expect(result1.code).toBe('INVALID_INPUT');

      // Test with invalid product
      const result2 = await processor.createAutomaticOrder(mockWaitlistEntry, null, mockBuyer);
      expect(result2.success).toBe(false);
      expect(result2.code).toBe('INVALID_INPUT');

      // Test with invalid buyer
      const result3 = await processor.createAutomaticOrder(mockWaitlistEntry, mockProduct, null);
      expect(result3.success).toBe(false);
      expect(result3.code).toBe('INVALID_INPUT');
    });
  });

  describe('processPayment', () => {
    const mockOrder = {
      id: 1001,
      total_price: 25.5,
    };

    const mockBuyer = {
      stellar_public_key: 'GTEST_BUYER_KEY',
      stellar_secret_key: 'STEST_BUYER_SECRET',
    };

    const mockFarmer = {
      stellar_public_key: 'GTEST_FARMER_KEY',
    };

    test('should process payment successfully', async () => {
      getBalance.mockResolvedValue(50.0);
      sendPayment.mockResolvedValue('payment_tx_hash');

      const result = await processor.processPayment(mockOrder, mockBuyer, mockFarmer);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('payment_tx_hash');
      expect(result.code).toBe('PAYMENT_SUCCESS');

      expect(sendPayment).toHaveBeenCalledWith({
        senderSecret: mockBuyer.stellar_secret_key,
        receiverPublicKey: mockFarmer.stellar_public_key,
        amount: mockOrder.total_price,
        memo: 'AutoOrder#1001',
      });
    });

    test('should fail when buyer has insufficient balance', async () => {
      getBalance.mockResolvedValue(10.0); // Less than required

      const result = await processor.processPayment(mockOrder, mockBuyer, mockFarmer);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_BALANCE');
      expect(result.error).toContain('Insufficient balance for payment');
    });

    test('should handle unfunded account error', async () => {
      getBalance.mockResolvedValue(50.0);
      const error = new Error('Account not found');
      error.code = 'account_not_found';
      sendPayment.mockRejectedValue(error);

      const result = await processor.processPayment(mockOrder, mockBuyer, mockFarmer);

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNFUNDED_ACCOUNT');
      expect(result.error).toBe('Buyer wallet not found or unfunded');
    });
  });

  describe('processWaitlistOnRestock', () => {
    beforeEach(() => {
      db.query = jest.fn();
    });

    test('should process multiple waitlist entries in FIFO order', async () => {
      const productId = 200;
      const availableQuantity = 10;

      const mockProduct = {
        id: productId,
        name: 'Test Product',
        price: 5.0,
        farmer_id: 300,
      };

      const mockWaitlistEntries = [
        {
          id: 1,
          buyer_id: 101,
          product_id: productId,
          quantity: 3,
          position: 1,
          buyer_name: 'Buyer 1',
          buyer_email: 'buyer1@test.com',
          stellar_public_key: 'GBUYER1',
          stellar_secret_key: 'SBUYER1',
        },
        {
          id: 2,
          buyer_id: 102,
          product_id: productId,
          quantity: 4,
          position: 2,
          buyer_name: 'Buyer 2',
          buyer_email: 'buyer2@test.com',
          stellar_public_key: 'GBUYER2',
          stellar_secret_key: 'SBUYER2',
        },
        {
          id: 3,
          buyer_id: 103,
          product_id: productId,
          quantity: 5,
          position: 3,
          buyer_name: 'Buyer 3',
          buyer_email: 'buyer3@test.com',
          stellar_public_key: 'GBUYER3',
          stellar_secret_key: 'SBUYER3',
        },
      ];

      // Mock database responses
      db.query
        .mockResolvedValueOnce({ rows: [mockProduct] }) // Get product
        .mockResolvedValueOnce({ rows: mockWaitlistEntries }); // Get waitlist entries

      // Mock successful order creation for first two entries
      getBalance.mockResolvedValue(50.0);
      sendPayment.mockResolvedValue('tx_hash');

      // Mock createAutomaticOrder to succeed for first two, fail for third (insufficient stock)
      const originalCreateOrder = processor.createAutomaticOrder;
      processor.createAutomaticOrder = jest
        .fn()
        .mockResolvedValueOnce({ success: true, orderId: 2001 }) // First entry succeeds
        .mockResolvedValueOnce({ success: true, orderId: 2002 }); // Second entry succeeds
      // Third entry won't be called due to insufficient stock

      // Mock deletion of processed entries
      db.query
        .mockResolvedValueOnce() // Delete entry 1
        .mockResolvedValueOnce() // Delete entry 2
        .mockResolvedValueOnce() // BEGIN for recalculation
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // Get remaining entries
        .mockResolvedValueOnce() // Update position
        .mockResolvedValueOnce(); // COMMIT

      const result = await processor.processWaitlistOnRestock(productId, availableQuantity);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2); // First two entries processed
      expect(result.skipped).toBe(1); // Third entry skipped (would need 5 but only 3 remaining)
      expect(result.remainingStock).toBe(3); // 10 - 3 - 4 = 3
      expect(result.totalEntries).toBe(3);

      // Verify orders were created for first two entries
      expect(processor.createAutomaticOrder).toHaveBeenCalledTimes(2);
    });

    test('should validate input parameters', async () => {
      // Test invalid product ID
      const result1 = await processor.processWaitlistOnRestock(null, 10);
      expect(result1.success).toBe(false);
      expect(result1.code).toBe('INVALID_INPUT');

      // Test invalid quantity
      const result2 = await processor.processWaitlistOnRestock(200, -5);
      expect(result2.success).toBe(false);
      expect(result2.code).toBe('INVALID_INPUT');
    });

    test('should handle product not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // No product found

      const result = await processor.processWaitlistOnRestock(999, 10);

      expect(result.success).toBe(false);
      expect(result.code).toBe('PRODUCT_NOT_FOUND');
      expect(result.error).toBe('Product not found or inactive');
    });
  });
});
