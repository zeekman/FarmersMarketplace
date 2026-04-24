/**
 * mailer.test.js
 * Tests for graceful SMTP configuration handling
 */

describe('Mailer - SMTP Configuration', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('should skip emails when SMTP is not configured', async () => {
    // Clear SMTP env vars
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const mailer = require('../utils/mailer');

    const result = await mailer.sendOrderEmails({
      order: { id: 1 },
      product: { name: 'Test', category: 'Produce', unit: 'kg' },
      buyer: { name: 'Buyer', email: 'buyer@test.com' },
      farmer: { name: 'Farmer', email: 'farmer@test.com' },
    });

    // Should return undefined (no-op)
    expect(result).toBeUndefined();
  });

  test('should skip emails when SMTP_USER is missing', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PASS = 'password';
    delete process.env.SMTP_USER;

    jest.resetModules();
    const mailer = require('../utils/mailer');

    const result = await mailer.sendLowStockAlert({
      product: { name: 'Test', quantity: 5, unit: 'kg', low_stock_threshold: 10 },
      farmer: { name: 'Farmer', email: 'farmer@test.com' },
    });

    expect(result).toBeUndefined();
  });

  test('should skip emails when SMTP_PASS is missing', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    delete process.env.SMTP_PASS;

    jest.resetModules();
    const mailer = require('../utils/mailer');

    const result = await mailer.sendStatusUpdateEmail({
      order: { id: 1 },
      product: { name: 'Test' },
      buyer: { name: 'Buyer', email: 'buyer@test.com' },
      newStatus: 'shipped',
    });

    expect(result).toBeUndefined();
  });

  test('should skip freshness alerts when SMTP not configured', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    jest.resetModules();
    const mailer = require('../utils/mailer');

    const result = await mailer.sendFreshnessAlert({
      product: { name: 'Lettuce', best_before: '2026-04-25' },
      farmer: { name: 'Farmer', email: 'farmer@test.com' },
      daysLeft: 2,
    });

    expect(result).toBeUndefined();
  });

  test('should skip contract alerts when SMTP not configured', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    jest.resetModules();
    const mailer = require('../utils/mailer');

    const result = await mailer.sendContractAlert({
      to: 'admin@test.com',
      alert: {
        alert_type: 'failed_invocations',
        contract_id: 'CABC123',
        message: 'Test alert',
        created_at: new Date().toISOString(),
      },
    });

    expect(result).toBeUndefined();
  });
});
