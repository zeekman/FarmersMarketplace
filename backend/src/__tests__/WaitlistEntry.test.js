/**
 * Unit tests for WaitlistEntry data model
 * Tests validation, serialization, and parsing functionality
 */

const WaitlistEntry = require('../models/WaitlistEntry');

describe('WaitlistEntry', () => {
  const validData = {
    id: 1,
    buyer_id: 123,
    product_id: 456,
    quantity: 2,
    position: 1,
    created_at: '2024-01-01T00:00:00.000Z',
  };

  describe('constructor', () => {
    test('creates instance with valid data', () => {
      const entry = new WaitlistEntry(validData);
      expect(entry.id).toBe(1);
      expect(entry.buyer_id).toBe(123);
      expect(entry.product_id).toBe(456);
      expect(entry.quantity).toBe(2);
      expect(entry.position).toBe(1);
      expect(entry.created_at).toBe('2024-01-01T00:00:00.000Z');
    });

    test('creates instance with empty data', () => {
      const entry = new WaitlistEntry();
      expect(entry.id).toBeNull();
      expect(entry.buyer_id).toBeNull();
      expect(entry.product_id).toBeNull();
      expect(entry.quantity).toBeNull();
      expect(entry.position).toBeNull();
      expect(entry.created_at).toBeNull();
    });

    test('includes optional populated fields', () => {
      const dataWithPopulated = {
        ...validData,
        buyer_name: 'John Doe',
        buyer_email: 'john@example.com',
        product_name: 'Test Product',
        product_price: 10.99,
      };

      const entry = new WaitlistEntry(dataWithPopulated);
      expect(entry.buyer_name).toBe('John Doe');
      expect(entry.buyer_email).toBe('john@example.com');
      expect(entry.product_name).toBe('Test Product');
      expect(entry.product_price).toBe(10.99);
    });
  });

  describe('validate', () => {
    test('validates correct data', () => {
      const entry = new WaitlistEntry(validData);
      const result = entry.validate();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects missing buyer_id', () => {
      const entry = new WaitlistEntry({ ...validData, buyer_id: null });
      const result = entry.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('buyer_id must be a positive integer');
    });

    test('rejects invalid buyer_id', () => {
      const entry = new WaitlistEntry({ ...validData, buyer_id: -1 });
      const result = entry.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('buyer_id must be a positive integer');
    });

    test('rejects missing product_id', () => {
      const entry = new WaitlistEntry({ ...validData, product_id: null });
      const result = entry.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('product_id must be a positive integer');
    });

    test('rejects invalid quantity', () => {
      const entry = new WaitlistEntry({ ...validData, quantity: 0 });
      const result = entry.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('quantity must be a positive integer');
    });

    test('rejects invalid position', () => {
      const entry = new WaitlistEntry({ ...validData, position: -1 });
      const result = entry.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('position must be a positive integer');
    });

    test('accepts null position', () => {
      const entry = new WaitlistEntry({ ...validData, position: null });
      const result = entry.validate();
      expect(result.isValid).toBe(true);
    });

    test('rejects invalid date string', () => {
      const entry = new WaitlistEntry({ ...validData, created_at: 'invalid-date' });
      const result = entry.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('created_at must be a valid date');
    });
  });

  describe('toJSON', () => {
    test('serializes basic fields', () => {
      const entry = new WaitlistEntry(validData);
      const json = entry.toJSON();

      expect(json).toEqual({
        id: 1,
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
      });
    });

    test('includes populated fields when present', () => {
      const dataWithPopulated = {
        ...validData,
        buyer_name: 'John Doe',
        product_name: 'Test Product',
      };

      const entry = new WaitlistEntry(dataWithPopulated);
      const json = entry.toJSON();

      expect(json.buyer_name).toBe('John Doe');
      expect(json.product_name).toBe('Test Product');
    });

    test('excludes null populated fields', () => {
      const entry = new WaitlistEntry(validData);
      const json = entry.toJSON();

      expect(json).not.toHaveProperty('buyer_name');
      expect(json).not.toHaveProperty('buyer_email');
      expect(json).not.toHaveProperty('product_name');
      expect(json).not.toHaveProperty('product_price');
    });
  });

  describe('fromJSON', () => {
    test('parses JSON string', () => {
      const jsonString = JSON.stringify(validData);
      const entry = WaitlistEntry.fromJSON(jsonString);

      expect(entry.id).toBe(1);
      expect(entry.buyer_id).toBe(123);
      expect(entry.product_id).toBe(456);
    });

    test('parses JSON object', () => {
      const entry = WaitlistEntry.fromJSON(validData);

      expect(entry.id).toBe(1);
      expect(entry.buyer_id).toBe(123);
      expect(entry.product_id).toBe(456);
    });

    test('throws error for invalid JSON string', () => {
      expect(() => {
        WaitlistEntry.fromJSON('invalid json');
      }).toThrow('Invalid JSON string');
    });

    test('throws error for invalid input type', () => {
      expect(() => {
        WaitlistEntry.fromJSON(123);
      }).toThrow('Input must be a JSON string or object');
    });
  });

  describe('format', () => {
    test('returns JSON representation', () => {
      const entry = new WaitlistEntry(validData);
      const formatted = entry.format();
      const json = entry.toJSON();

      expect(formatted).toEqual(json);
    });
  });

  describe('fromDatabaseRow', () => {
    test('creates instance from database row', () => {
      const row = {
        id: 1,
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        buyer_name: 'John Doe',
        product_name: 'Test Product',
      };

      const entry = WaitlistEntry.fromDatabaseRow(row);

      expect(entry.id).toBe(1);
      expect(entry.buyer_name).toBe('John Doe');
      expect(entry.product_name).toBe('Test Product');
    });

    test('returns null for null row', () => {
      const entry = WaitlistEntry.fromDatabaseRow(null);
      expect(entry).toBeNull();
    });
  });

  describe('validateCreateInput', () => {
    test('validates correct input', () => {
      const input = {
        buyer_id: 123,
        product_id: 456,
        quantity: 2,
      };

      const result = WaitlistEntry.validateCreateInput(input);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toEqual(input);
    });

    test('rejects invalid input', () => {
      const input = {
        buyer_id: -1,
        product_id: 'invalid',
        quantity: 0,
      };

      const result = WaitlistEntry.validateCreateInput(input);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('buyer_id must be a positive integer');
      expect(result.errors).toContain('product_id must be a positive integer');
      expect(result.errors).toContain('quantity must be a positive integer');
    });
  });

  describe('equals', () => {
    test('returns true for equal entries', () => {
      const entry1 = new WaitlistEntry(validData);
      const entry2 = new WaitlistEntry(validData);

      expect(entry1.equals(entry2)).toBe(true);
    });

    test('returns false for different entries', () => {
      const entry1 = new WaitlistEntry(validData);
      const entry2 = new WaitlistEntry({ ...validData, quantity: 3 });

      expect(entry1.equals(entry2)).toBe(false);
    });

    test('returns false for non-WaitlistEntry object', () => {
      const entry = new WaitlistEntry(validData);

      expect(entry.equals({})).toBe(false);
      expect(entry.equals(null)).toBe(false);
    });
  });

  describe('clone', () => {
    test('creates identical copy', () => {
      const entry = new WaitlistEntry(validData);
      const clone = entry.clone();

      expect(clone.equals(entry)).toBe(true);
      expect(clone).not.toBe(entry); // Different instances
    });
  });

  describe('JSON round trip property', () => {
    test('parsing then formatting produces equivalent object', () => {
      const entry = new WaitlistEntry(validData);
      const json = entry.toJSON();
      const parsed = WaitlistEntry.fromJSON(json);
      const formatted = parsed.format();

      expect(formatted).toEqual(json);
    });

    test('round trip with string serialization', () => {
      const entry = new WaitlistEntry(validData);
      const jsonString = JSON.stringify(entry.toJSON());
      const parsed = WaitlistEntry.fromJSON(jsonString);

      expect(parsed.equals(entry)).toBe(true);
    });
  });
});
