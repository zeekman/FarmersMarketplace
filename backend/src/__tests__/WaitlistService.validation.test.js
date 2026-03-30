/**
 * Enhanced validation tests for WaitlistService
 * Tests the comprehensive validation logic added in task 2.4
 */

const WaitlistService = require('../services/WaitlistService');
const db = require('../db/schema');

// Mock the database
jest.mock('../db/schema');

describe('WaitlistService Enhanced Validation', () => {
  let service;

  beforeEach(() => {
    service = new WaitlistService();
    jest.clearAllMocks();
  });

  describe('Enhanced Input Validation', () => {
    test('rejects null/undefined buyerId', async () => {
      const result1 = await service.joinWaitlist(null, 1, 2);
      const result2 = await service.joinWaitlist(undefined, 1, 2);

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('buyer_id is required');
      expect(result1.code).toBe('INVALID_INPUT');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('buyer_id is required');
      expect(result2.code).toBe('INVALID_INPUT');
    });

    test('rejects invalid buyerId types', async () => {
      const result1 = await service.joinWaitlist(-1, 1, 2);
      const result2 = await service.joinWaitlist(0, 1, 2);
      const result3 = await service.joinWaitlist(1.5, 1, 2);

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('buyer_id must be a positive integer');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('buyer_id must be a positive integer');

      expect(result3.success).toBe(false);
      expect(result3.error).toContain('buyer_id must be a positive integer');
    });

    test('rejects excessive quantity values', async () => {
      const result = await service.joinWaitlist(123, 1, 1001);

      expect(result.success).toBe(false);
      expect(result.error).toContain('quantity cannot exceed 1000 units');
      expect(result.code).toBe('INVALID_INPUT');
    });

    test('rejects null/undefined productId', async () => {
      const result1 = await service.joinWaitlist(123, null, 2);
      const result2 = await service.joinWaitlist(123, undefined, 2);

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('product_id is required');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('product_id is required');
    });
  });

  describe('Enhanced Business Logic Validation', () => {
    test('validates buyer exists and has correct role', async () => {
      // Mock buyer not found
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.joinWaitlist(999, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Buyer not found');
      expect(result.code).toBe('BUYER_NOT_FOUND');
    });

    test('rejects inactive buyer accounts', async () => {
      // Mock inactive buyer
      db.query.mockResolvedValueOnce({
        rows: [{ id: 123, role: 'buyer', is_active: false }],
      });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is inactive');
      expect(result.code).toBe('ACCOUNT_INACTIVE');
    });

    test('rejects non-buyer users', async () => {
      // Mock farmer trying to join waitlist
      db.query.mockResolvedValueOnce({
        rows: [{ id: 123, role: 'farmer', is_active: true }],
      });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Only buyers can join waitlists');
      expect(result.code).toBe('INVALID_ROLE');
    });

    test('validates product exists and is active', async () => {
      // Mock valid buyer
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 123, role: 'buyer', is_active: true }],
        })
        // Mock inactive product
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Test Product', quantity: 0, is_active: false }],
        });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Product is no longer available');
      expect(result.code).toBe('PRODUCT_INACTIVE');
    });

    test('provides detailed in-stock product error message', async () => {
      // Mock valid buyer
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 123, role: 'buyer', is_active: true }],
        })
        // Mock in-stock product
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Test Product', quantity: 5, is_active: true }],
        });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Test Product');
      expect(result.error).toContain('5 units in stock');
      expect(result.code).toBe('PRODUCT_IN_STOCK');
    });

    test('provides detailed duplicate entry error message', async () => {
      // Mock valid buyer and product
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 123, role: 'buyer', is_active: true }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Test Product', quantity: 0, is_active: true }],
        })
        // Mock existing waitlist entry
        .mockResolvedValueOnce({
          rows: [{ id: 1, position: 3, created_at: '2024-01-01T00:00:00.000Z' }],
        });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('position 3');
      expect(result.error).toContain('1/1/2024');
      expect(result.code).toBe('DUPLICATE_ENTRY');
    });
  });

  describe('Enhanced Error Handling', () => {
    test('handles database errors gracefully with error codes', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to join waitlist');
      expect(result.code).toBe('INTERNAL_ERROR');
    });

    test('validates limit parameter in getProductWaitlistEntries', async () => {
      const result1 = await service.getProductWaitlistEntries(1, -1);
      const result2 = await service.getProductWaitlistEntries(1, 1001);
      const result3 = await service.getProductWaitlistEntries(1, 1.5);

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('limit must be a positive integer');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('between 1 and 1000');

      expect(result3.success).toBe(false);
      expect(result3.error).toContain('limit must be a positive integer');
    });
  });

  describe('Enhanced leaveWaitlist Validation', () => {
    test('validates input parameters for leaveWaitlist', async () => {
      const result1 = await service.leaveWaitlist(null, 1);
      const result2 = await service.leaveWaitlist(123, null);

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('buyer_id is required');
      expect(result1.code).toBe('INVALID_INPUT');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('product_id is required');
      expect(result2.code).toBe('INVALID_INPUT');
    });

    test('uses transaction for atomic position updates', async () => {
      // Mock valid buyer
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 123, role: 'buyer', is_active: true }],
        })
        // Mock existing entry
        .mockResolvedValueOnce({
          rows: [{ id: 1, position: 2 }],
        })
        // Mock transaction commands
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 3 }] }) // UPDATE with RETURNING
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.leaveWaitlist(123, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('2 positions updated');
      expect(result.code).toBe('SUCCESS');

      // Verify transaction was used
      expect(db.query).toHaveBeenCalledWith('BEGIN');
      expect(db.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('Enhanced Status Methods', () => {
    test('validates input for getWaitlistStatus', async () => {
      const result = await service.getWaitlistStatus(-1, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('buyer_id must be a positive integer');
      expect(result.code).toBe('INVALID_INPUT');
    });

    test('includes success codes in status responses', async () => {
      // Mock valid product and no waitlist entry
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Test Product', quantity: 0, is_active: true }],
        })
        .mockResolvedValueOnce({ rows: [] }) // no entry
        .mockResolvedValueOnce({ rows: [{ total: '5' }] }); // count

      const result = await service.getWaitlistStatus(123, 1);

      expect(result.success).toBe(true);
      expect(result.onWaitlist).toBe(false);
      expect(result.code).toBe('NOT_ON_WAITLIST');
    });
  });
});
