/**
 * Unit tests for WaitlistService
 * Tests core CRUD operations, position management, and FIFO ordering
 */

const WaitlistService = require('../services/WaitlistService');
const db = require('../db/schema');

// Mock the database
jest.mock('../db/schema');

describe('WaitlistService', () => {
  let service;

  beforeEach(() => {
    service = new WaitlistService();
    jest.clearAllMocks();
  });

  describe('joinWaitlist', () => {
    test('successfully joins waitlist for out-of-stock product', async () => {
      // Mock product exists and is out of stock
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1, quantity: 0 }] }) // product check
        .mockResolvedValueOnce({ rows: [] }) // existing entry check
        .mockResolvedValueOnce({ rows: [{ next_position: 1 }] }) // position calculation
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              buyer_id: 123,
              product_id: 1,
              quantity: 2,
              position: 1,
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ],
        }) // insert
        .mockResolvedValueOnce({ rows: [{ total: '1' }] }); // count

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(true);
      expect(result.position).toBe(1);
      expect(result.totalWaiting).toBe(1);
      expect(result.entry).toBeDefined();
    });

    test('rejects joining waitlist for in-stock product', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1, quantity: 5 }] });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Product is currently available for purchase');
    });

    test('rejects joining waitlist when already on waitlist', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1, quantity: 0 }] }) // product check
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing entry check

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Already on waitlist for this product');
    });

    test('rejects joining waitlist for non-existent product', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.joinWaitlist(123, 999, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Product not found');
    });

    test('assigns correct position in FIFO order', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1, quantity: 0 }] }) // product check
        .mockResolvedValueOnce({ rows: [] }) // existing entry check
        .mockResolvedValueOnce({ rows: [{ next_position: 3 }] }) // position calculation (2 people already waiting)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              buyer_id: 123,
              product_id: 1,
              quantity: 2,
              position: 3,
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '3' }] });

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(true);
      expect(result.position).toBe(3);
      expect(result.totalWaiting).toBe(3);
    });

    test('validates input parameters', async () => {
      const result = await service.joinWaitlist(-1, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('buyer_id must be a positive integer');
    });
  });

  describe('leaveWaitlist', () => {
    test('successfully leaves waitlist and updates positions', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1, position: 2 }] }) // entry check
        .mockResolvedValueOnce({ rows: [] }) // delete
        .mockResolvedValueOnce({ rows: [] }); // update positions

      const result = await service.leaveWaitlist(123, 1);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully left waitlist');

      // Verify position update query was called
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE waitlist_entries SET position = position - 1 WHERE product_id = $1 AND position > $2',
        [1, 2]
      );
    });

    test('rejects leaving waitlist when not on waitlist', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.leaveWaitlist(123, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not on waitlist for this product');
    });
  });

  describe('getWaitlistStatus', () => {
    test('returns status for buyer on waitlist', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ position: 2 }] }) // entry check
        .mockResolvedValueOnce({ rows: [{ total: '5' }] }); // count

      const result = await service.getWaitlistStatus(123, 1);

      expect(result.success).toBe(true);
      expect(result.onWaitlist).toBe(true);
      expect(result.position).toBe(2);
      expect(result.totalWaiting).toBe(5);
    });

    test('returns status for buyer not on waitlist', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // entry check
        .mockResolvedValueOnce({ rows: [{ total: '3' }] }); // count

      const result = await service.getWaitlistStatus(123, 1);

      expect(result.success).toBe(true);
      expect(result.onWaitlist).toBe(false);
      expect(result.position).toBeUndefined();
      expect(result.totalWaiting).toBe(3);
    });
  });

  describe('getBuyerWaitlistEntries', () => {
    test('returns all waitlist entries for buyer', async () => {
      const mockRows = [
        {
          id: 1,
          buyer_id: 123,
          product_id: 1,
          quantity: 2,
          position: 1,
          created_at: '2024-01-01T00:00:00.000Z',
          product_name: 'Test Product',
          product_price: 10.99,
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await service.getBuyerWaitlistEntries(123);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].product_name).toBe('Test Product');
    });
  });

  describe('getProductWaitlistEntries', () => {
    test('returns waitlist entries in FIFO order', async () => {
      const mockRows = [
        {
          id: 1,
          buyer_id: 123,
          product_id: 1,
          quantity: 2,
          position: 1,
          created_at: '2024-01-01T00:00:00.000Z',
          buyer_name: 'John Doe',
          buyer_email: 'john@example.com',
        },
        {
          id: 2,
          buyer_id: 124,
          product_id: 1,
          quantity: 1,
          position: 2,
          created_at: '2024-01-01T01:00:00.000Z',
          buyer_name: 'Jane Smith',
          buyer_email: 'jane@example.com',
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await service.getProductWaitlistEntries(1);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].position).toBe(1);
      expect(result.data[1].position).toBe(2);
    });

    test('respects limit parameter', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await service.getProductWaitlistEntries(1, 5);

      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), [1, 5]);
    });
  });

  describe('getWaitlistCount', () => {
    test('returns correct count', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: '7' }] });

      const result = await service.getWaitlistCount(1);

      expect(result.success).toBe(true);
      expect(result.count).toBe(7);
    });
  });

  describe('recalculatePositions', () => {
    test('recalculates positions based on created_at order', async () => {
      const mockRows = [{ id: 1 }, { id: 3 }, { id: 2 }];

      db.query
        .mockResolvedValueOnce({ rows: mockRows }) // get entries
        .mockResolvedValue({ rows: [] }); // update queries

      const result = await service.recalculatePositions(1);

      expect(result.success).toBe(true);
      expect(result.updated).toBe(3);

      // Verify positions were updated correctly
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE waitlist_entries SET position = $1 WHERE id = $2',
        [1, 1]
      );
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE waitlist_entries SET position = $1 WHERE id = $2',
        [2, 3]
      );
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE waitlist_entries SET position = $1 WHERE id = $2',
        [3, 2]
      );
    });
  });

  describe('error handling', () => {
    test('handles database errors gracefully', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await service.joinWaitlist(123, 1, 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to join waitlist');
    });
  });
});
