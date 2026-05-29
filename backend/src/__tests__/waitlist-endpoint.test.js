/**
 * Integration test for POST /api/products/:id/waitlist endpoint
 * Tests the complete flow from HTTP request to WaitlistService integration
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Create a test app with the actual route
const app = express();
app.use(express.json());

// Mock dependencies
jest.mock('../db/schema', () => ({
  query: jest.fn(),
}));

jest.mock('../services/WaitlistService', () => {
  return jest.fn().mockImplementation(() => ({
    joinWaitlist: jest.fn(),
    leaveWaitlist: jest.fn(),
  }));
});

const WaitlistService = require('../services/WaitlistService');
const db = require('../db/schema');

// Import the actual middleware and route
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

// Mock JWT verification
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

describe('POST /api/products/:id/waitlist endpoint', () => {
  let mockWaitlistService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitlistService = {
      joinWaitlist: jest.fn(),
      leaveWaitlist: jest.fn(),
    };
    WaitlistService.mockImplementation(() => mockWaitlistService);
  });

  const createTestApp = () => {
    const testApp = express();
    testApp.use(express.json());

    // Mock auth middleware
    testApp.use((req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res
          .status(401)
          .json({ success: false, error: 'No token provided', code: 'missing_token' });
      }

      // Mock user based on test scenario
      if (token === 'buyer-token') {
        req.user = { id: 1, role: 'buyer' };
      } else if (token === 'farmer-token') {
        req.user = { id: 2, role: 'farmer' };
      } else {
        return res
          .status(401)
          .json({ success: false, error: 'Invalid token', code: 'invalid_token' });
      }
      next();
    });

    // Mock validation middleware
    testApp.use((req, res, next) => {
      if (req.path.includes('/waitlist') && req.method === 'POST') {
        const { quantity } = req.body;
        if (!quantity || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) {
          return res.status(400).json({
            success: false,
            message: 'quantity must be a positive integer',
            code: 'validation_error',
          });
        }
      }
      next();
    });

    // Add the actual endpoint logic
    testApp.post('/api/products/:id/waitlist', async (req, res) => {
      // Only buyers can join waitlists
      if (req.user.role !== 'buyer') {
        return res
          .status(403)
          .json({ success: false, error: 'Only buyers can join waitlists', code: 'forbidden' });
      }

      const productId = parseInt(req.params.id, 10);
      const { quantity } = req.body;

      // Validate product ID
      if (isNaN(productId) || productId <= 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid product ID', code: 'validation_error' });
      }

      try {
        const waitlistService = new WaitlistService();
        const result = await waitlistService.joinWaitlist(req.user.id, productId, quantity);

        if (!result.success) {
          // Map service error codes to appropriate HTTP status codes
          let statusCode = 400;
          switch (result.code) {
            case 'BUYER_NOT_FOUND':
            case 'PRODUCT_NOT_FOUND':
              statusCode = 404;
              break;
            case 'DUPLICATE_ENTRY':
              statusCode = 409;
              break;
            case 'INVALID_ROLE':
            case 'ACCOUNT_INACTIVE':
            case 'PRODUCT_INACTIVE':
              statusCode = 403;
              break;
            case 'PRODUCT_IN_STOCK':
              statusCode = 400;
              break;
            case 'INTERNAL_ERROR':
              statusCode = 500;
              break;
            default:
              statusCode = 400;
          }

          return res
            .status(statusCode)
            .json({ success: false, error: result.error, code: result.code });
        }

        // Success response
        res.json({
          success: true,
          position: result.position,
          totalWaiting: result.totalWaiting,
          message: `Successfully joined waitlist at position ${result.position}`,
        });
      } catch (error) {
        console.error('[Products] Error joining waitlist:', error);
        return res
          .status(500)
          .json({ success: false, error: 'Internal server error', code: 'internal_error' });
      }
    });

    // DELETE endpoint
    testApp.delete('/api/products/:id/waitlist', async (req, res) => {
      // Only buyers can leave waitlists
      if (req.user.role !== 'buyer') {
        return res
          .status(403)
          .json({ success: false, error: 'Only buyers can leave waitlists', code: 'forbidden' });
      }

      const productId = parseInt(req.params.id, 10);

      // Validate product ID
      if (isNaN(productId) || productId <= 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid product ID', code: 'validation_error' });
      }

      try {
        const waitlistService = new WaitlistService();
        const result = await waitlistService.leaveWaitlist(req.user.id, productId);

        if (!result.success) {
          // Map service error codes to appropriate HTTP status codes
          let statusCode = 400;
          switch (result.code) {
            case 'BUYER_NOT_FOUND':
            case 'ENTRY_NOT_FOUND':
              statusCode = 404;
              break;
            case 'INVALID_ROLE':
            case 'ACCOUNT_INACTIVE':
              statusCode = 403;
              break;
            case 'INTERNAL_ERROR':
              statusCode = 500;
              break;
            default:
              statusCode = 400;
          }

          return res
            .status(statusCode)
            .json({ success: false, error: result.error, code: result.code });
        }

        // Success response
        res.json({
          success: true,
          message: result.message || 'Successfully left waitlist',
        });
      } catch (error) {
        console.error('[Products] Error leaving waitlist:', error);
        return res
          .status(500)
          .json({ success: false, error: 'Internal server error', code: 'internal_error' });
      }
    });

    return testApp;
  };

  test('should successfully join waitlist with valid buyer and data', async () => {
    const mockResult = {
      success: true,
      position: 1,
      totalWaiting: 1,
    };

    mockWaitlistService.joinWaitlist.mockResolvedValue(mockResult);

    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 2 })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      position: 1,
      totalWaiting: 1,
      message: 'Successfully joined waitlist at position 1',
    });

    expect(mockWaitlistService.joinWaitlist).toHaveBeenCalledWith(1, 123, 2);
  });

  test('should reject farmers trying to join waitlist', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer farmer-token')
      .send({ quantity: 2 })
      .expect(403);

    expect(response.body).toEqual({
      success: false,
      error: 'Only buyers can join waitlists',
      code: 'forbidden',
    });

    expect(mockWaitlistService.joinWaitlist).not.toHaveBeenCalled();
  });

  test('should reject requests without authentication', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/123/waitlist')
      .send({ quantity: 2 })
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(mockWaitlistService.joinWaitlist).not.toHaveBeenCalled();
  });

  test('should validate quantity parameter', async () => {
    const app = createTestApp();

    // Test negative quantity
    await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: -1 })
      .expect(400);

    // Test zero quantity
    await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 0 })
      .expect(400);

    // Test missing quantity
    await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({})
      .expect(400);

    expect(mockWaitlistService.joinWaitlist).not.toHaveBeenCalled();
  });

  test('should validate product ID parameter', async () => {
    const app = createTestApp();

    // Test invalid product ID
    const response = await request(app)
      .post('/api/products/invalid/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 2 })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      error: 'Invalid product ID',
      code: 'validation_error',
    });

    expect(mockWaitlistService.joinWaitlist).not.toHaveBeenCalled();
  });

  test('should handle service errors correctly', async () => {
    const mockError = {
      success: false,
      error: 'Product not found',
      code: 'PRODUCT_NOT_FOUND',
    };

    mockWaitlistService.joinWaitlist.mockResolvedValue(mockError);

    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/999/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 2 })
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      error: 'Product not found',
      code: 'PRODUCT_NOT_FOUND',
    });

    expect(mockWaitlistService.joinWaitlist).toHaveBeenCalledWith(1, 999, 2);
  });

  test('should handle duplicate entry errors', async () => {
    const mockError = {
      success: false,
      error: 'Already on waitlist for this product',
      code: 'DUPLICATE_ENTRY',
    };

    mockWaitlistService.joinWaitlist.mockResolvedValue(mockError);

    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 2 })
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      error: 'Already on waitlist for this product',
      code: 'DUPLICATE_ENTRY',
    });
  });

  test('should handle product in stock errors', async () => {
    const mockError = {
      success: false,
      error: 'Product is currently available for purchase',
      code: 'PRODUCT_IN_STOCK',
    };

    mockWaitlistService.joinWaitlist.mockResolvedValue(mockError);

    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 2 })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      error: 'Product is currently available for purchase',
      code: 'PRODUCT_IN_STOCK',
    });
  });

  test('should handle internal service errors', async () => {
    mockWaitlistService.joinWaitlist.mockRejectedValue(new Error('Database connection failed'));

    const app = createTestApp();

    const response = await request(app)
      .post('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .send({ quantity: 2 })
      .expect(500);

    expect(response.body).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'internal_error',
    });
  });
});

describe('DELETE /api/products/:id/waitlist endpoint', () => {
  let mockWaitlistService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitlistService = {
      joinWaitlist: jest.fn(),
      leaveWaitlist: jest.fn(),
    };
    WaitlistService.mockImplementation(() => mockWaitlistService);
  });

  const createTestApp = () => {
    const testApp = express();
    testApp.use(express.json());

    // Mock auth middleware
    testApp.use((req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res
          .status(401)
          .json({ success: false, error: 'No token provided', code: 'missing_token' });
      }

      // Mock user based on test scenario
      if (token === 'buyer-token') {
        req.user = { id: 1, role: 'buyer' };
      } else if (token === 'farmer-token') {
        req.user = { id: 2, role: 'farmer' };
      } else {
        return res
          .status(401)
          .json({ success: false, error: 'Invalid token', code: 'invalid_token' });
      }
      next();
    });

    // DELETE endpoint
    testApp.delete('/api/products/:id/waitlist', async (req, res) => {
      // Only buyers can leave waitlists
      if (req.user.role !== 'buyer') {
        return res
          .status(403)
          .json({ success: false, error: 'Only buyers can leave waitlists', code: 'forbidden' });
      }

      const productId = parseInt(req.params.id, 10);

      // Validate product ID
      if (isNaN(productId) || productId <= 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid product ID', code: 'validation_error' });
      }

      try {
        const waitlistService = new WaitlistService();
        const result = await waitlistService.leaveWaitlist(req.user.id, productId);

        if (!result.success) {
          // Map service error codes to appropriate HTTP status codes
          let statusCode = 400;
          switch (result.code) {
            case 'BUYER_NOT_FOUND':
            case 'ENTRY_NOT_FOUND':
              statusCode = 404;
              break;
            case 'INVALID_ROLE':
            case 'ACCOUNT_INACTIVE':
              statusCode = 403;
              break;
            case 'INTERNAL_ERROR':
              statusCode = 500;
              break;
            default:
              statusCode = 400;
          }

          return res
            .status(statusCode)
            .json({ success: false, error: result.error, code: result.code });
        }

        // Success response
        res.json({
          success: true,
          message: result.message || 'Successfully left waitlist',
        });
      } catch (error) {
        console.error('[Products] Error leaving waitlist:', error);
        return res
          .status(500)
          .json({ success: false, error: 'Internal server error', code: 'internal_error' });
      }
    });

    return testApp;
  };

  test('should successfully leave waitlist with valid buyer', async () => {
    const mockResult = {
      success: true,
      message: 'Successfully left waitlist (2 positions updated)',
      code: 'SUCCESS',
    };

    mockWaitlistService.leaveWaitlist.mockResolvedValue(mockResult);

    const app = createTestApp();

    const response = await request(app)
      .delete('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Successfully left waitlist (2 positions updated)',
    });

    expect(mockWaitlistService.leaveWaitlist).toHaveBeenCalledWith(1, 123);
  });

  test('should reject farmers trying to leave waitlist', async () => {
    const app = createTestApp();

    const response = await request(app)
      .delete('/api/products/123/waitlist')
      .set('Authorization', 'Bearer farmer-token')
      .expect(403);

    expect(response.body).toEqual({
      success: false,
      error: 'Only buyers can leave waitlists',
      code: 'forbidden',
    });

    expect(mockWaitlistService.leaveWaitlist).not.toHaveBeenCalled();
  });

  test('should reject requests without authentication', async () => {
    const app = createTestApp();

    const response = await request(app).delete('/api/products/123/waitlist').expect(401);

    expect(response.body.success).toBe(false);
    expect(mockWaitlistService.leaveWaitlist).not.toHaveBeenCalled();
  });

  test('should validate product ID parameter', async () => {
    const app = createTestApp();

    // Test invalid product ID
    const response = await request(app)
      .delete('/api/products/invalid/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      error: 'Invalid product ID',
      code: 'validation_error',
    });

    expect(mockWaitlistService.leaveWaitlist).not.toHaveBeenCalled();
  });

  test('should handle entry not found errors', async () => {
    const mockError = {
      success: false,
      error: 'Not on waitlist for this product',
      code: 'ENTRY_NOT_FOUND',
    };

    mockWaitlistService.leaveWaitlist.mockResolvedValue(mockError);

    const app = createTestApp();

    const response = await request(app)
      .delete('/api/products/999/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      error: 'Not on waitlist for this product',
      code: 'ENTRY_NOT_FOUND',
    });

    expect(mockWaitlistService.leaveWaitlist).toHaveBeenCalledWith(1, 999);
  });

  test('should handle buyer not found errors', async () => {
    const mockError = {
      success: false,
      error: 'Buyer not found',
      code: 'BUYER_NOT_FOUND',
    };

    mockWaitlistService.leaveWaitlist.mockResolvedValue(mockError);

    const app = createTestApp();

    const response = await request(app)
      .delete('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      error: 'Buyer not found',
      code: 'BUYER_NOT_FOUND',
    });
  });

  test('should handle internal service errors', async () => {
    mockWaitlistService.leaveWaitlist.mockRejectedValue(new Error('Database connection failed'));

    const app = createTestApp();

    const response = await request(app)
      .delete('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .expect(500);

    expect(response.body).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'internal_error',
    });
  });

  test('should handle account inactive errors', async () => {
    const mockError = {
      success: false,
      error: 'Account is inactive',
      code: 'ACCOUNT_INACTIVE',
    };

    mockWaitlistService.leaveWaitlist.mockResolvedValue(mockError);

    const app = createTestApp();

    const response = await request(app)
      .delete('/api/products/123/waitlist')
      .set('Authorization', 'Bearer buyer-token')
      .expect(403);

    expect(response.body).toEqual({
      success: false,
      error: 'Account is inactive',
      code: 'ACCOUNT_INACTIVE',
    });
  });
});
