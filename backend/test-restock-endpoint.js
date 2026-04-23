/**
 * Simple test to verify the enhanced restock endpoint works
 */

const request = require('supertest');
const express = require('express');

// Create a minimal app for testing
const app = express();
app.use(express.json());

// Mock dependencies
const mockDb = {
  query: jest.fn(),
};

const mockAuth = (req, res, next) => {
  req.user = { id: 1, role: 'farmer' };
  next();
};

const mockErr = (res, status, message, code) => {
  return res.status(status).json({ success: false, error: message, code });
};

const mockSendBackInStockEmail = jest.fn();

const mockAutoProcessor = {
  processWaitlistOnRestock: jest.fn(),
};

// Mock the modules
jest.mock('../src/db/schema', () => mockDb);
jest.mock('../src/middleware/auth', () => mockAuth);
jest.mock('../src/middleware/error', () => ({ err: mockErr }));
jest.mock('../src/utils/mailer', () => ({ sendBackInStockEmail: mockSendBackInStockEmail }));
jest.mock('../src/services/AutomaticOrderProcessor', () => {
  return jest.fn().mockImplementation(() => mockAutoProcessor);
});

// Import the restock route
const restockRouter = require('./src/routes/products_restock_only');
app.use('/api/products', restockRouter);

describe('Enhanced Restock Endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should process waitlist when restocking from out-of-stock', async () => {
    // Mock product query - out of stock
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test Product', quantity: 0, farmer_id: 1 }] })
      .mockResolvedValueOnce() // UPDATE query
      .mockResolvedValueOnce({ rows: [] }); // stock alerts query

    // Mock waitlist processing
    mockAutoProcessor.processWaitlistOnRestock.mockResolvedValue({
      success: true,
      processed: 2,
      skipped: 1,
      totalEntries: 3,
      remainingStock: 5,
      errors: [],
    });

    const response = await request(app).patch('/api/products/1/restock').send({ quantity: 10 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Restocked successfully');
    expect(response.body.waitlist).toEqual({
      processed: 2,
      skipped: 1,
      totalEntries: 3,
      remainingStock: 5,
      errors: [],
    });

    expect(mockAutoProcessor.processWaitlistOnRestock).toHaveBeenCalledWith(1, 10);
  });

  test('should not process waitlist when product was already in stock', async () => {
    // Mock product query - in stock
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test Product', quantity: 5, farmer_id: 1 }] })
      .mockResolvedValueOnce(); // UPDATE query

    const response = await request(app).patch('/api/products/1/restock').send({ quantity: 10 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Restocked successfully');
    expect(response.body.waitlist).toBeUndefined();

    expect(mockAutoProcessor.processWaitlistOnRestock).not.toHaveBeenCalled();
  });

  test('should handle waitlist processing errors gracefully', async () => {
    // Mock product query - out of stock
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test Product', quantity: 0, farmer_id: 1 }] })
      .mockResolvedValueOnce() // UPDATE query
      .mockResolvedValueOnce({ rows: [] }); // stock alerts query

    // Mock waitlist processing failure
    mockAutoProcessor.processWaitlistOnRestock.mockResolvedValue({
      success: false,
      error: 'Database connection failed',
      code: 'INTERNAL_ERROR',
    });

    const response = await request(app).patch('/api/products/1/restock').send({ quantity: 10 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Restocked successfully');
    // Should still succeed even if waitlist processing fails
  });
});

console.log('Restock endpoint test created successfully');
