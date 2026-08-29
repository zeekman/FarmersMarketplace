/**
 * db-boolean-normalization.test.js
 * Tests for boolean normalization across SQLite and PostgreSQL
 */

describe('Database - Boolean Normalization', () => {
  let db;

  beforeEach(() => {
    jest.resetModules();
  });

  test('should normalize SQLite integer 0 to false for active column', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, name: 'User', active: 0 },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM users WHERE id = 1');

    expect(result.rows[0].active).toBe(false);
    expect(typeof result.rows[0].active).toBe('boolean');
  });

  test('should normalize SQLite integer 1 to true for active column', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, name: 'User', active: 1 },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM users WHERE id = 1');

    expect(result.rows[0].active).toBe(true);
    expect(typeof result.rows[0].active).toBe('boolean');
  });

  test('should preserve null values for boolean columns', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, name: 'User', active: null },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM users WHERE id = 1');

    expect(result.rows[0].active).toBeNull();
  });

  test('should normalize fee_bumped column', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, fee_bumped: 0 },
            { id: 2, fee_bumped: 1 },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM orders');

    expect(result.rows[0].fee_bumped).toBe(false);
    expect(result.rows[1].fee_bumped).toBe(true);
  });

  test('should normalize is_preorder column', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, is_preorder: 0 },
            { id: 2, is_preorder: 1 },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM products');

    expect(result.rows[0].is_preorder).toBe(false);
    expect(result.rows[1].is_preorder).toBe(true);
  });

  test('should handle mixed types in boolean columns', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, active: 0 },
            { id: 2, active: 1 },
            { id: 3, active: true },
            { id: 4, active: false },
            { id: 5, active: null },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM users');

    expect(result.rows[0].active).toBe(false);
    expect(result.rows[1].active).toBe(true);
    expect(result.rows[2].active).toBe(true);
    expect(result.rows[3].active).toBe(false);
    expect(result.rows[4].active).toBeNull();
  });

  test('should not affect non-boolean columns', async () => {
    process.env.DATABASE_URL = '';
    jest.mock('better-sqlite3', () => {
      return jest.fn(() => ({
        prepare: jest.fn(() => ({
          all: jest.fn(() => [
            { id: 1, name: 'User', email: 'user@test.com', active: 1 },
          ]),
        })),
        exec: jest.fn(),
      }));
    });

    db = require('../db/schema');
    const result = await db.query('SELECT * FROM users WHERE id = 1');

    expect(result.rows[0].id).toBe(1);
    expect(result.rows[0].name).toBe('User');
    expect(result.rows[0].email).toBe('user@test.com');
    expect(result.rows[0].active).toBe(true);
  });
});
