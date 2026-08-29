# Failed Emails Cleanup Solution

## Overview

This solution implements automated cleanup for the `failed_emails` table to prevent unbounded growth of permanently-failed email records. The cleanup process removes old failed email entries that are unlikely to be useful after the underlying issues have been resolved.

## Components

### 1. Database Migration (026_failed_emails.sql)

Creates the `failed_emails` table with the following structure:
- `id`: Primary key
- `recipient`: Email address that failed
- `subject`: Email subject line
- `body`: Email content
- `error_message`: Failure reason
- `retry_count`: Number of retry attempts
- `first_attempt`: Initial send attempt timestamp
- `last_attempt`: Last retry attempt timestamp
- `created_at`: Record creation timestamp (used for retention)

Includes an index on `created_at` for efficient pruning queries.

### 2. Cleanup Job (backend/src/jobs/cleanupFailedEmails.js)

- **Function**: `cleanupFailedEmails(retentionDays)`
  - Removes failed email records older than the specified retention period
  - Returns the number of deleted records
  - Logs cleanup progress and results

- **Function**: `startFailedEmailCleanupJob()`
  - Schedules the cleanup job as a daily cron task (2:00 AM)
  - Uses configurable retention period from environment variables
  - Handles job errors gracefully

### 3. Configuration

New environment variable added to `.env.example`:
```env
# Failed email cleanup retention (optional — defaults to 7 days)
FAILED_EMAIL_RETENTION_DAYS=7
```

This follows the project's existing pattern of configurable retention periods (similar to database backup retention).

### 4. Integration

The cleanup job is automatically started when the server boots via `backend/src/index.js`, alongside the existing subscription processing job.

### 5. Tests

Comprehensive test suite (`backend/tests/cleanup-failed-emails.test.js`) covering:
- Basic cleanup functionality
- Date calculations for various retention periods
- Environment variable configuration
- Error handling
- Edge cases (0-day retention, invalid configurations)
- Logging verification

## Usage

### Automatic Operation

Once deployed, the cleanup job runs automatically:
- **Schedule**: Daily at 2:00 AM
- **Default Retention**: 7 days
- **Configurable**: Via `FAILED_EMAIL_RETENTION_DAYS` environment variable

### Manual Execution

For immediate cleanup or testing, you can manually trigger the cleanup:

```javascript
const { cleanupFailedEmails } = require('./src/jobs/cleanupFailedEmails');

// Clean up records older than 7 days (default)
cleanupFailedEmails().then(deletedCount => {
  console.log(`Cleaned up ${deletedCount} records`);
});

// Clean up records older than 30 days
cleanupFailedEmails(30).then(deletedCount => {
  console.log(`Cleaned up ${deletedCount} records`);
});
```

### Manual Runbook

If automated cleanup needs to be performed manually:

1. **Connect to your database** (SQLite or PostgreSQL)

2. **Check current failed email count**:
   ```sql
   SELECT COUNT(*) FROM failed_emails;
   SELECT COUNT(*) FROM failed_emails WHERE created_at < datetime('now', '-7 days');
   ```

3. **Manual cleanup query** (removes records older than 7 days):
   ```sql
   DELETE FROM failed_emails WHERE created_at < datetime('now', '-7 days');
   ```

4. **Custom retention period** (example: 30 days):
   ```sql
   DELETE FROM failed_emails WHERE created_at < datetime('now', '-30 days');
   ```

5. **Verify cleanup**:
   ```sql
   SELECT COUNT(*) FROM failed_emails;
   ```

## Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `FAILED_EMAIL_RETENTION_DAYS` | 7 | Number of days to retain failed email records |

## Monitoring

The cleanup job logs its activity:
- Start of cleanup with retention period and cutoff date
- Number of records pruned (if any)
- "No old records to prune" message when table is already clean
- Error messages if cleanup fails

Example log output:
```
[cleanup-failed-emails] Cleanup job scheduled (daily at 2:00 AM, 7-day retention)
[cleanup-failed-emails] Pruning failed emails older than 7 days (before 2026-07-20T02:00:00.000Z)
[cleanup-failed-emails] Pruned 42 old failed email record(s)
```

## Testing

Run the test suite:
```bash
npm test -- --testPathPattern=cleanup-failed-emails
```

The tests verify:
- Correct SQL query generation
- Accurate date calculations for retention periods
- Environment variable handling
- Error scenarios
- Integration with the cron scheduler

## Migration

To apply the database migration:
```bash
npm run migrate
```

To rollback (removes the failed_emails table):
```bash
npm run migrate:rollback
```

## Security Considerations

- The cleanup job only removes old records; it doesn't expose sensitive email content
- Database queries use parameterized statements to prevent injection
- Failed email content in the database should already be sanitized by the mailer system
- The cleanup runs during low-traffic hours (2:00 AM) to minimize performance impact

## Performance Impact

- Daily cleanup queries are efficient due to the indexed `created_at` column
- Cleanup runs during off-peak hours
- The query execution time scales with the number of old records (typically minimal for daily cleanup)
- Index overhead is minimal (single column, simple DATE comparison)

## Compatibility

- Works with both SQLite (development) and PostgreSQL (production)
- Uses standard SQL DATE functions compatible with both database systems
- Follows existing project patterns for job scheduling and database access