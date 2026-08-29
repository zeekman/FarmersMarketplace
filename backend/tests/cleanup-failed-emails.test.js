const { cleanupFailedEmails, startFailedEmailCleanupJob } = require('../src/jobs/cleanupFailedEmails');
const { mockDb } = require('./setup');
const logger = require('../src/logger');

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// The job logs via logger.js (winston), not console — spy on the logger instead
// of console so these assertions reflect what the code actually calls.
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('Failed Email Cleanup Job', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cleanupFailedEmails', () => {
    it('should delete failed emails older than retention period', async () => {
      // Mock the database run method to simulate deletion
      const mockRun = jest.fn().mockReturnValue({ changes: 3 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      const retentionDays = 7;
      const result = await cleanupFailedEmails(retentionDays);

      // Verify the correct SQL was executed
      expect(mockDb.prepare).toHaveBeenCalledWith(`
    DELETE FROM failed_emails 
    WHERE created_at < ?
  `);

      // Check that the date calculation is correct (7 days ago)
      const expectedCutoffDate = new Date();
      expectedCutoffDate.setDate(expectedCutoffDate.getDate() - retentionDays);
      const callArgs = mockRun.mock.calls[0][0];
      const actualDate = new Date(callArgs);
      
      // Allow for small time differences (test execution time)
      const timeDiff = Math.abs(actualDate.getTime() - expectedCutoffDate.getTime());
      expect(timeDiff).toBeLessThan(1000); // Less than 1 second difference

      expect(result).toBe(3);
    });

    it('should return 0 when no records are deleted', async () => {
      const mockRun = jest.fn().mockReturnValue({ changes: 0 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      const result = await cleanupFailedEmails(14);

      expect(result).toBe(0);
    });

    it('should use default retention of 7 days when not specified', async () => {
      const mockRun = jest.fn().mockReturnValue({ changes: 1 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      await cleanupFailedEmails();

      const callArgs = mockRun.mock.calls[0][0];
      const actualDate = new Date(callArgs);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - 7);

      const timeDiff = Math.abs(actualDate.getTime() - expectedDate.getTime());
      expect(timeDiff).toBeLessThan(1000);
    });

    it('should handle custom retention periods', async () => {
      const mockRun = jest.fn().mockReturnValue({ changes: 2 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      await cleanupFailedEmails(30);

      const callArgs = mockRun.mock.calls[0][0];
      const actualDate = new Date(callArgs);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - 30);

      const timeDiff = Math.abs(actualDate.getTime() - expectedDate.getTime());
      expect(timeDiff).toBeLessThan(1000);
    });

    it('should log appropriate messages for cleanup results', async () => {
      // Test with deletions
      const mockRun = jest.fn().mockReturnValue({ changes: 5 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      await cleanupFailedEmails(7);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[cleanup-failed-emails] Pruning failed emails older than 7 days')
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[cleanup-failed-emails] Pruned 5 old failed email record(s)'
      );
    });

    it('should log when no records are pruned', async () => {
      const mockRun = jest.fn().mockReturnValue({ changes: 0 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      await cleanupFailedEmails(7);

      expect(logger.info).toHaveBeenCalledWith(
        '[cleanup-failed-emails] No old failed email records to prune'
      );
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockDb.prepare.mockImplementation(() => {
        throw dbError;
      });

      await expect(cleanupFailedEmails(7)).rejects.toThrow('Database connection failed');
    });
  });

  describe('startFailedEmailCleanupJob', () => {
    it('should schedule cleanup job with default 7-day retention', () => {
      const cron = require('node-cron');
      delete process.env.FAILED_EMAIL_RETENTION_DAYS;

      startFailedEmailCleanupJob();

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 2 * * *',
        expect.any(Function)
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[cleanup-failed-emails] Cleanup job scheduled (daily at 2:00 AM, 7-day retention)'
      );
    });

    it('should schedule cleanup job with custom retention from env var', () => {
      const cron = require('node-cron');
      process.env.FAILED_EMAIL_RETENTION_DAYS = '14';

      startFailedEmailCleanupJob();

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 2 * * *',
        expect.any(Function)
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[cleanup-failed-emails] Cleanup job scheduled (daily at 2:00 AM, 14-day retention)'
      );

      delete process.env.FAILED_EMAIL_RETENTION_DAYS;
    });

    it('should handle invalid retention days gracefully', () => {
      const cron = require('node-cron');
      process.env.FAILED_EMAIL_RETENTION_DAYS = 'invalid';

      startFailedEmailCleanupJob();

      // Should fallback to NaN -> 0, but parseInt with base 10 of 'invalid' gives NaN
      // The job should still be scheduled
      expect(cron.schedule).toHaveBeenCalledWith(
        '0 2 * * *',
        expect.any(Function)
      );

      delete process.env.FAILED_EMAIL_RETENTION_DAYS;
    });

    it('should handle job execution errors', async () => {
      const cron = require('node-cron');
      const consoleErrorSpy = jest.spyOn(console, 'error');
      
      // Mock cleanupFailedEmails to throw an error
      const originalCleanup = require('../src/jobs/cleanupFailedEmails').cleanupFailedEmails;
      jest.doMock('../src/jobs/cleanupFailedEmails', () => ({
        ...require.requireActual('../src/jobs/cleanupFailedEmails'),
        cleanupFailedEmails: jest.fn().mockRejectedValue(new Error('Cleanup failed')),
      }));

      startFailedEmailCleanupJob();

      // Get the scheduled function and execute it
      const scheduledFunction = cron.schedule.mock.calls[0][1];
      await scheduledFunction();

      // Wait for async error handling
      await new Promise(resolve => setImmediate(resolve));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[cleanup-failed-emails] Job error:',
        'Cleanup failed'
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should calculate correct cutoff dates for various retention periods', async () => {
      const testCases = [
        { retention: 1, description: '1 day' },
        { retention: 7, description: '1 week' },
        { retention: 30, description: '1 month' },
        { retention: 90, description: '3 months' },
      ];

      for (const testCase of testCases) {
        const mockRun = jest.fn().mockReturnValue({ changes: 0 });
        mockDb.prepare.mockReturnValue({ run: mockRun });

        await cleanupFailedEmails(testCase.retention);

        const callArgs = mockRun.mock.calls[0][0];
        const actualDate = new Date(callArgs);
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() - testCase.retention);

        const timeDiff = Math.abs(actualDate.getTime() - expectedDate.getTime());
        expect(timeDiff).toBeLessThan(1000); // Less than 1 second difference

        mockRun.mockClear();
        mockDb.prepare.mockClear();
      }
    });

    it('should work correctly with edge case retention periods', async () => {
      const mockRun = jest.fn().mockReturnValue({ changes: 1 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      // Test with 0 days (should delete everything)
      await cleanupFailedEmails(0);

      const callArgs = mockRun.mock.calls[0][0];
      const actualDate = new Date(callArgs);
      const now = new Date();

      // For 0 days retention, cutoff should be approximately now
      const timeDiff = Math.abs(actualDate.getTime() - now.getTime());
      expect(timeDiff).toBeLessThan(1000);
    });
  });
});