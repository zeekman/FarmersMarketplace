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

describe('sendWithRetry', () => {
  const mailOptions = { to: 'buyer@test.com', subject: 'Order Confirmed', text: 'body' };
  let mailer;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_USER = 'user@test.com';
    process.env.SMTP_PASS = 'pass';
    mailer = require('../utils/mailer');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  test('retries 3 times with exponential backoff delays on failure', async () => {
    const sendMail = jest.spyOn(mailer.transporter, 'sendMail').mockRejectedValue(new Error('SMTP error'));

    const promise = mailer.sendWithRetry(mailOptions, 'other');

    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    await promise;

    expect(sendMail).toHaveBeenCalledTimes(3);
    sendMail.mockRestore();
  });

  test('after 3 failures, stores in failed_emails for critical type', async () => {
    const sendMail = jest.spyOn(mailer.transporter, 'sendMail').mockRejectedValue(new Error('SMTP down'));
    const mockRun = jest.fn();
    const mockDb = { prepare: jest.fn(() => ({ run: mockRun })) };

    const promise = mailer.sendWithRetry(mailOptions, 'order_confirmation', mockDb);

    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    await promise;

    expect(mockDb.prepare).toHaveBeenCalledWith(
      'INSERT INTO failed_emails (recipient, subject, error, type) VALUES (?, ?, ?, ?)'
    );
    expect(mockRun).toHaveBeenCalledWith('buyer@test.com', 'Order Confirmed', 'SMTP down', 'order_confirmation');
    sendMail.mockRestore();
  });

  test('succeeds on second retry without storing in failed_emails', async () => {
    const sendMail = jest.spyOn(mailer.transporter, 'sendMail')
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({});
    const mockDb = { prepare: jest.fn() };

    const promise = mailer.sendWithRetry(mailOptions, 'order_confirmation', mockDb);

    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    await promise;

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(mockDb.prepare).not.toHaveBeenCalled();
    sendMail.mockRestore();
  });
});
