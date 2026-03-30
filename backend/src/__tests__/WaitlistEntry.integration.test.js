/**
 * Integration tests for WaitlistEntry with database schema
 * Tests database integration and schema compatibility
 */

const WaitlistEntry = require('../models/WaitlistEntry');

describe('WaitlistEntry Database Integration', () => {
  describe('schema compatibility', () => {
    test('validates required database fields', () => {
      const entry = new WaitlistEntry({
        buyer_id: 1,
        product_id: 2,
        quantity: 3,
        position: 1,
      });

      const validation = entry.validate();
      expect(validation.isValid).toBe(true);
    });

    test('handles database row format correctly', () => {
      // Simulate a database row with all fields
      const dbRow = {
        id: 1,
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01 00:00:00', // SQLite datetime format
        buyer_name: 'John Doe',
        buyer_email: 'john@example.com',
        product_name: 'Test Product',
        product_price: 10.99,
      };

      const entry = WaitlistEntry.fromDatabaseRow(dbRow);

      expect(entry.id).toBe(1);
      expect(entry.buyer_id).toBe(123);
      expect(entry.product_id).toBe(456);
      expect(entry.quantity).toBe(2);
      expect(entry.position).toBe(1);
      expect(entry.created_at).toBe('2024-01-01 00:00:00');
      expect(entry.buyer_name).toBe('John Doe');
      expect(entry.buyer_email).toBe('john@example.com');
      expect(entry.product_name).toBe('Test Product');
      expect(entry.product_price).toBe(10.99);
    });

    test('serializes for API response correctly', () => {
      const entry = new WaitlistEntry({
        id: 1,
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        buyer_name: 'John Doe',
        product_name: 'Test Product',
      });

      const apiResponse = entry.format();

      expect(apiResponse).toEqual({
        id: 1,
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        buyer_name: 'John Doe',
        product_name: 'Test Product',
      });
    });

    test('validates create input for API endpoints', () => {
      const validInput = {
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
      };

      const result = WaitlistEntry.validateCreateInput(validInput);

      expect(result.isValid).toBe(true);
      expect(result.data).toEqual(validInput);
    });

    test('rejects invalid create input', () => {
      const invalidInput = {
        buyer_id: 'not-a-number',
        product_id: null,
        quantity: -1,
      };

      const result = WaitlistEntry.validateCreateInput(invalidInput);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('JSON serialization requirements', () => {
    test('round trip serialization preserves data', () => {
      const originalData = {
        id: 1,
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
      };

      // Create entry, serialize to JSON, parse back, format again
      const entry1 = new WaitlistEntry(originalData);
      const json1 = entry1.toJSON();
      const entry2 = WaitlistEntry.fromJSON(json1);
      const json2 = entry2.format();

      // Should be equivalent after round trip
      expect(json2).toEqual(json1);
      expect(entry2.equals(entry1)).toBe(true);
    });

    test('handles JSON string parsing', () => {
      const data = {
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
      };

      const jsonString = JSON.stringify(data);
      const entry = WaitlistEntry.fromJSON(jsonString);

      expect(entry.buyer_id).toBe(123);
      expect(entry.product_id).toBe(456);
      expect(entry.quantity).toBe(2);
    });

    test('provides descriptive error for invalid JSON', () => {
      expect(() => {
        WaitlistEntry.fromJSON('{ invalid json }');
      }).toThrow(/Invalid JSON string/);
    });
  });

  describe('validation edge cases', () => {
    test('handles boundary values correctly', () => {
      const entry = new WaitlistEntry({
        buyer_id: 1, // minimum valid value
        product_id: 1, // minimum valid value
        quantity: 1, // minimum valid value
        position: 1, // minimum valid value
      });

      const validation = entry.validate();
      expect(validation.isValid).toBe(true);
    });

    test('rejects zero and negative values', () => {
      const testCases = [
        { field: 'buyer_id', value: 0 },
        { field: 'buyer_id', value: -1 },
        { field: 'product_id', value: 0 },
        { field: 'product_id', value: -1 },
        { field: 'quantity', value: 0 },
        { field: 'quantity', value: -1 },
        { field: 'position', value: 0 },
        { field: 'position', value: -1 },
      ];

      testCases.forEach(({ field, value }) => {
        const data = {
          buyer_id: 1,
          product_id: 1,
          quantity: 1,
          position: null, // Set to null so position validation is optional
          [field]: value,
        };

        const entry = new WaitlistEntry(data);
        const validation = entry.validate();

        expect(validation.isValid).toBe(false);
        expect(
          validation.errors.some(
            (error) => error.includes(field) && error.includes('positive integer')
          )
        ).toBe(true);
      });
    });

    test('accepts null values for optional fields', () => {
      const entry = new WaitlistEntry({
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: null, // Optional field
        created_at: null, // Optional field
      });

      const validation = entry.validate();
      expect(validation.isValid).toBe(true);
    });
  });
});
