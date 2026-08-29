'use strict';

const cron = require('node-cron');
const db = require('../db/schema');
const logger = require('../logger');

const THIRTY_DAYS_AGO = db.isPostgres
  ? `NOW() - INTERVAL '30 days'`
  : `datetime('now', '-30 days')`;

/**
 * Anonymize PII for users deactivated more than 30 days ago (GDPR).
 * Idempotent: skips rows already anonymized (email matches the anonymized pattern).
 *
 * @returns {Promise<{anonymized: number, errors: number}>}
 */
async function anonymizeDeactivatedUsers() {
  logger.info('[anonymize-job] Starting PII anonymization for deactivated users');

  const { rows } = await db.query(
    `SELECT id FROM users
     WHERE deactivated_at IS NOT NULL
       AND deactivated_at <= ${THIRTY_DAYS_AGO}
       AND email NOT LIKE 'deleted-%@anonymized.invalid'`,
    []
  );

  let anonymized = 0;
  let errors = 0;

  for (const { id } of rows) {
    try {
      await db.query(
        `UPDATE users SET
           name = $1,
           email = $2,
           password = $3,
           stellar_public_key = NULL,
           stellar_secret_key = NULL,
           stellar_mnemonic = NULL,
           bio = NULL,
           location = NULL,
           avatar_url = NULL,
           anonymized_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [`Deleted User`, `deleted-${id}@anonymized.invalid`, '[anonymized]', id]
      );
      anonymized++;
    } catch (e) {
      errors++;
      logger.error('[anonymize-job] Failed to anonymize user', { userId: id, error: e.message });
    }
  }

  logger.info('[anonymize-job] Done', { anonymized, errors });
  return { anonymized, errors };
}

function startAnonymizeJob() {
  // Run daily at 03:00 UTC
  cron.schedule('0 3 * * *', anonymizeDeactivatedUsers, { scheduled: true, timezone: 'UTC' });
  logger.info('[anonymize-job] Scheduled daily at 03:00 UTC');
}

module.exports = { anonymizeDeactivatedUsers, startAnonymizeJob };
