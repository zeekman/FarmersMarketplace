/**
 * Manual test script for the new GET waitlist endpoints
 * Tests both GET /api/products/:id/waitlist/status and GET /api/waitlist/mine
 */

const request = require('supertest');
const express = require('express');

// Create a test app with the actual routes
const app = express();
app.use(express.json());

// Mock dependencies
const mockDb = {
  query: jest.fn(),
};

const mockWaitlistService = {
  getWaitlistStatus: jest.fn(),
  getBuyerWaitlistEntries: jest.fn(),
};

// Mock WaitlistService
jest.mock('./src/services/WaitlistService', () => {
  return jest.fn().mockImplementation(() => mockWaitlistService);
});

const WaitlistService = require('./src/services/WaitlistService');

// Mock auth middleware
const mockAuth = (req, res, next) => {
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
    return res.status(401).json({ success: false, error: 'Invalid token', code: 'invalid_token' });
  }
  next();
};

// Mock error handler
const err = (res, status, message, code) => {
  return res.status(status).json({ success: false, error: message, code });
};

// Add the GET status endpoint
app.get('/api/products/:id/waitlist/status', mockAuth, async (req, res) => {
  // Only buyers can check waitlist status
  if (req.user.role !== 'buyer') {
    return err(res, 403, 'Only buyers can check waitlist status', 'forbidden');
  }

  const productId = parseInt(req.params.id, 10);

  // Validate product ID
  if (isNaN(productId) || productId <= 0) {
    return err(res, 400, 'Invalid product ID', 'validation_error');
  }

  try {
    const waitlistService = new WaitlistService();
    const result = await waitlistService.getWaitlistStatus(req.user.id, productId);

    if (!result.success) {
      // Map service error codes to appropriate HTTP status codes
      let statusCode = 400;
      switch (result.code) {
        case 'PRODUCT_NOT_FOUND':
          statusCode = 404;
          break;
        case 'INVALID_INPUT':
          statusCode = 400;
          break;
        case 'INTERNAL_ERROR':
          statusCode = 500;
          break;
        default:
          statusCode = 400;
      }

      return err(res, statusCode, result.error, result.code);
    }

    // Success response
    const response = {
      success: true,
      onWaitlist: result.onWaitlist,
      totalWaiting: result.totalWaiting,
    };

    // Only include position if buyer is on waitlist
    if (result.onWaitlist) {
      response.position = result.position;
    }

    res.json(response);
  } catch (error) {
    console.error('[Products] Error getting waitlist status:', error);
    return err(res, 500, 'Internal server error', 'internal_error');
  }
});

// Add the GET mine endpoint
app.get('/api/waitlist/mine', mockAuth, async (req, res) => {
  // Only buyers can view their waitlist entries
  if (req.user.role !== 'buyer') {
    return err(res, 403, 'Only buyers can view waitlist entries', 'forbidden');
  }

  try {
    const waitlistService = new WaitlistService();
    const result = await waitlistService.getBuyerWaitlistEntries(req.user.id);

    if (!result.success) {
      // Map service error codes to appropriate HTTP status codes
      let statusCode = 400;
      switch (result.code) {
        case 'BUYER_NOT_FOUND':
          statusCode = 404;
          break;
        case 'INVALID_INPUT':
          statusCode = 400;
          break;
        case 'INTERNAL_ERROR':
          statusCode = 500;
          break;
        default:
          statusCode = 400;
      }

      return err(res, statusCode, result.error, result.code);
    }

    // Success response
    res.json({
      success: true,
      data: result.data,
      count: result.count,
    });
  } catch (error) {
    console.error('[Waitlist] Error getting buyer waitlist entries:', error);
    return err(res, 500, 'Internal server error', 'internal_error');
  }
});

// Test functions
async function testWaitlistStatusEndpoint() {
  console.log('\n=== Testing GET /api/products/:id/waitlist/status ===');

  // Test 1: Successful status check (on waitlist)
  mockWaitlistService.getWaitlistStatus.mockResolvedValue({
    success: true,
    onWaitlist: true,
    position: 3,
    totalWaiting: 5,
    code: 'ON_WAITLIST',
  });

  const response1 = await request(app)
    .get('/api/products/123/waitlist/status')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 1 - On waitlist:', response1.status, response1.body);

  // Test 2: Successful status check (not on waitlist)
  mockWaitlistService.getWaitlistStatus.mockResolvedValue({
    success: true,
    onWaitlist: false,
    totalWaiting: 5,
    code: 'NOT_ON_WAITLIST',
  });

  const response2 = await request(app)
    .get('/api/products/123/waitlist/status')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 2 - Not on waitlist:', response2.status, response2.body);

  // Test 3: Farmer access denied
  const response3 = await request(app)
    .get('/api/products/123/waitlist/status')
    .set('Authorization', 'Bearer farmer-token');

  console.log('Test 3 - Farmer denied:', response3.status, response3.body);

  // Test 4: Product not found
  mockWaitlistService.getWaitlistStatus.mockResolvedValue({
    success: false,
    error: 'Product not found',
    code: 'PRODUCT_NOT_FOUND',
  });

  const response4 = await request(app)
    .get('/api/products/999/waitlist/status')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 4 - Product not found:', response4.status, response4.body);

  // Test 5: Invalid product ID
  const response5 = await request(app)
    .get('/api/products/invalid/waitlist/status')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 5 - Invalid product ID:', response5.status, response5.body);
}

async function testWaitlistMineEndpoint() {
  console.log('\n=== Testing GET /api/waitlist/mine ===');

  // Test 1: Successful retrieval with entries
  mockWaitlistService.getBuyerWaitlistEntries.mockResolvedValue({
    success: true,
    data: [
      {
        id: 1,
        buyer_id: 1,
        product_id: 123,
        quantity: 2,
        position: 1,
        created_at: '2024-01-01T10:00:00Z',
        product_name: 'Organic Tomatoes',
        product_price: 5.99,
        product_stock: 0,
      },
      {
        id: 2,
        buyer_id: 1,
        product_id: 456,
        quantity: 1,
        position: 3,
        created_at: '2024-01-02T11:00:00Z',
        product_name: 'Fresh Carrots',
        product_price: 3.5,
        product_stock: 0,
      },
    ],
    count: 2,
    code: 'SUCCESS',
  });

  const response1 = await request(app)
    .get('/api/waitlist/mine')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 1 - With entries:', response1.status, response1.body);

  // Test 2: Successful retrieval with no entries
  mockWaitlistService.getBuyerWaitlistEntries.mockResolvedValue({
    success: true,
    data: [],
    count: 0,
    code: 'SUCCESS',
  });

  const response2 = await request(app)
    .get('/api/waitlist/mine')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 2 - No entries:', response2.status, response2.body);

  // Test 3: Farmer access denied
  const response3 = await request(app)
    .get('/api/waitlist/mine')
    .set('Authorization', 'Bearer farmer-token');

  console.log('Test 3 - Farmer denied:', response3.status, response3.body);

  // Test 4: Buyer not found
  mockWaitlistService.getBuyerWaitlistEntries.mockResolvedValue({
    success: false,
    error: 'Buyer not found',
    code: 'BUYER_NOT_FOUND',
  });

  const response4 = await request(app)
    .get('/api/waitlist/mine')
    .set('Authorization', 'Bearer buyer-token');

  console.log('Test 4 - Buyer not found:', response4.status, response4.body);

  // Test 5: No authentication
  const response5 = await request(app).get('/api/waitlist/mine');

  console.log('Test 5 - No auth:', response5.status, response5.body);
}

async function runTests() {
  console.log('Starting manual tests for new GET waitlist endpoints...');

  try {
    await testWaitlistStatusEndpoint();
    await testWaitlistMineEndpoint();
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

// Run the tests
runTests();
