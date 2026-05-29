/**
 * admin-users-filter.test.js
 * Tests for GET /api/admin/users with active filter
 */

jest.mock('../db/schema');
const db = require('../db/schema');
const request = require('supertest');
const app = require('../app');

describe('GET /api/admin/users - Active Filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock auth middleware
    jest.mock('../middleware/auth', () => (req, res, next) => {
      req.user = { id: 1, role: 'admin' };
      next();
    });
    jest.mock('../middleware/adminAuth', () => (req, res, next) => {
      next();
    });
  });

  test('should return all users when no active filter is provided', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ count: 3 }],
    });
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'User 1', email: 'user1@test.com', role: 'buyer', active: true },
        { id: 2, name: 'User 2', email: 'user2@test.com', role: 'farmer', active: false },
        { id: 3, name: 'User 3', email: 'user3@test.com', role: 'buyer', active: true },
      ],
    });

    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination.total).toBe(3);
  });

  test('should filter for active users when active=1', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ count: 2 }],
    });
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'User 1', email: 'user1@test.com', role: 'buyer', active: true },
        { id: 3, name: 'User 3', email: 'user3@test.com', role: 'buyer', active: true },
      ],
    });

    const res = await request(app).get('/api/admin/users?active=1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data.every((u) => u.active === true)).toBe(true);
  });

  test('should filter for deactivated users when active=0', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ count: 1 }],
    });
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 2, name: 'User 2', email: 'user2@test.com', role: 'farmer', active: false },
      ],
    });

    const res = await request(app).get('/api/admin/users?active=0');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].active).toBe(false);
  });

  test('should support active=true string', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ count: 2 }],
    });
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'User 1', email: 'user1@test.com', role: 'buyer', active: true },
        { id: 3, name: 'User 3', email: 'user3@test.com', role: 'buyer', active: true },
      ],
    });

    const res = await request(app).get('/api/admin/users?active=true');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('should work with pagination and active filter', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ count: 5 }],
    });
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'User 1', email: 'user1@test.com', role: 'buyer', active: true },
        { id: 3, name: 'User 3', email: 'user3@test.com', role: 'buyer', active: true },
      ],
    });

    const res = await request(app).get('/api/admin/users?active=1&page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.total).toBe(5);
  });
});
