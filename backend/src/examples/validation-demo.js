/**
 * Demonstration of enhanced validation logic in WaitlistService
 * This script shows the comprehensive validation added in task 2.4
 */

const WaitlistService = require('../services/WaitlistService');

// Mock database for demonstration
const mockDb = {
  query: jest.fn(),
};

// Replace the real db with mock for demo
jest.mock('../db/schema', () => mockDb);

async function demonstrateValidation() {
  const service = new WaitlistService();

  console.log('=== WaitlistService Enhanced Validation Demo ===\n');

  // Test 1: Input validation
  console.log('1. Testing input validation:');

  const invalidInputs = [
    { buyerId: null, productId: 1, quantity: 2, description: 'null buyerId' },
    { buyerId: -1, productId: 1, quantity: 2, description: 'negative buyerId' },
    { buyerId: 123, productId: null, quantity: 2, description: 'null productId' },
    { buyerId: 123, productId: 1, quantity: 1001, description: 'excessive quantity' },
    { buyerId: 123, productId: 1, quantity: 0, description: 'zero quantity' },
  ];

  for (const input of invalidInputs) {
    const result = await service.joinWaitlist(input.buyerId, input.productId, input.quantity);
    console.log(
      `   ${input.description}: ${result.success ? 'PASSED' : 'REJECTED'} - ${result.error || 'OK'}`
    );
  }

  console.log('\n2. Testing business logic validation:');

  // Mock scenarios for business logic validation
  const scenarios = [
    {
      name: 'Buyer not found',
      mocks: [
        { rows: [] }, // No buyer found
      ],
      expected: 'BUYER_NOT_FOUND',
    },
    {
      name: 'Inactive buyer account',
      mocks: [{ rows: [{ id: 123, role: 'buyer', is_active: false }] }],
      expected: 'ACCOUNT_INACTIVE',
    },
    {
      name: 'Non-buyer user role',
      mocks: [{ rows: [{ id: 123, role: 'farmer', is_active: true }] }],
      expected: 'INVALID_ROLE',
    },
    {
      name: 'Product not found',
      mocks: [
        { rows: [{ id: 123, role: 'buyer', is_active: true }] }, // Valid buyer
        { rows: [] }, // No product found
      ],
      expected: 'PRODUCT_NOT_FOUND',
    },
    {
      name: 'Product in stock',
      mocks: [
        { rows: [{ id: 123, role: 'buyer', is_active: true }] }, // Valid buyer
        { rows: [{ id: 1, name: 'Test Product', quantity: 5, is_active: true }] }, // In stock
      ],
      expected: 'PRODUCT_IN_STOCK',
    },
    {
      name: 'Duplicate entry',
      mocks: [
        { rows: [{ id: 123, role: 'buyer', is_active: true }] }, // Valid buyer
        { rows: [{ id: 1, name: 'Test Product', quantity: 0, is_active: true }] }, // Valid product
        { rows: [{ id: 1, position: 3, created_at: '2024-01-01T00:00:00.000Z' }] }, // Existing entry
      ],
      expected: 'DUPLICATE_ENTRY',
    },
  ];

  for (const scenario of scenarios) {
    mockDb.query.mockClear();

    // Set up mocks for this scenario
    for (let i = 0; i < scenario.mocks.length; i++) {
      mockDb.query.mockResolvedValueOnce(scenario.mocks[i]);
    }

    const result = await service.joinWaitlist(123, 1, 2);
    const success = result.code === scenario.expected;
    console.log(
      `   ${scenario.name}: ${success ? 'PASSED' : 'FAILED'} - Expected: ${scenario.expected}, Got: ${result.code || 'NO_CODE'}`
    );
    if (!success) {
      console.log(`      Error: ${result.error}`);
    }
  }

  console.log('\n3. Testing enhanced error messages:');

  // Test detailed error messages
  mockDb.query.mockClear();
  mockDb.query
    .mockResolvedValueOnce({ rows: [{ id: 123, role: 'buyer', is_active: true }] })
    .mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Premium Organic Tomatoes', quantity: 15, is_active: true }],
    });

  const inStockResult = await service.joinWaitlist(123, 1, 2);
  console.log(`   In-stock product message: "${inStockResult.error}"`);

  mockDb.query.mockClear();
  mockDb.query
    .mockResolvedValueOnce({ rows: [{ id: 123, role: 'buyer', is_active: true }] })
    .mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Test Product', quantity: 0, is_active: true }],
    })
    .mockResolvedValueOnce({
      rows: [{ id: 1, position: 5, created_at: '2024-03-15T10:30:00.000Z' }],
    });

  const duplicateResult = await service.joinWaitlist(123, 1, 2);
  console.log(`   Duplicate entry message: "${duplicateResult.error}"`);

  console.log('\n=== Validation Demo Complete ===');
}

// Only run if this file is executed directly
if (require.main === module) {
  // Set up Jest mocks
  global.jest = {
    fn: () => ({
      mockResolvedValueOnce: function (value) {
        this._mockValues = this._mockValues || [];
        this._mockValues.push(value);
        return this;
      },
      mockClear: function () {
        this._mockValues = [];
        this._callIndex = 0;
      },
    }),
  };

  demonstrateValidation().catch(console.error);
}

module.exports = { demonstrateValidation };
