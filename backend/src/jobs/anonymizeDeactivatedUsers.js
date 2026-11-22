'use strict';

const cron = require('node-cron');
const db = require('../db/schema');
const logger = require('../logger');

const THIRTY_DAYS_AGO = db.isPostgres
  ? `NOW() - INTERVAL '30 days'`
  : `datetime('now', '-30 days')`;

/**
 * Determine whether a user still holds value or has open obligations that
 * depend on their custodial Stellar key. If so, the key material must NOT be
 * destroyed, otherwise funds become unrecoverable and pending payouts break.
 *
 * @param {number|string} userId
 * @returns {Promise<{blocked: boolean, reason: string|null}>}
 */
async function checkOpenValueOrObligations(userId) {
  // On-chain balance is not queried here (no network in the job); we rely on
  // the recorded balance and open obligations. Any positive balance blocks.
  try {
    const { rows } = await db.query(
      `SELECT
         COALESCE((SELECT balance FROM wallets WHERE user_id = $1), 0) AS wallet_balance`,
      [userId]
    );
    const walletBalance = Number(rows[0] && rows[0].wallet_balance) || 0;
    if (walletBalance > 0) {
      return { blocked: true, reason: `wallet_balance:${walletBalance}` };
    }
  } catch (e) {
    // If we cannot verify the balance, fail safe and block anonymisation.
    return { blocked: true, reason: `balance_check_failed:${e.message}` };
  }

  const obligationChecks = [
    {
      reason: 'open_escrows',
      sql: `SELECT COUNT(*) AS c FROM escrows
            WHERE (farmer_id = $1 OR buyer_id = $1)
              AND status IN ('pending', 'funded', 'active')`,
    },
    {
      reason: 'open_payment_streams',
      sql: `SELECT COUNT(*) AS c FROM payment_streams
            WHERE (sender_id = $1 OR recipient_id = $1)
              AND status IN ('active', 'pending')`,
    },
    {
      reason: 'open_earnings_claims',
      sql: `SELECT COUNT(*) AS c FROM creator_earnings
            WHERE creator_id = $1 AND claimed_at IS NULL`,
    },
  ];

  for (const check of obligationChecks) {
    try {
      const { rows } = await db.query(check.sql, [userId]);
      const count = Number(rows[0] && rows[0].c) || 0;
      if (count > 0) {
        return { blocked: true, reason: `${check.reason}:${count}` };
      }
    } catch (e) {
      // Unknown table/column or query error: fail safe.
      return { blocked: true, reason: `${check.reason}_check_failed:${e.message}` };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Scrub PII from related tables for a user being anonymised.
 * Best-effort per table: a missing table/column is logged but does not abort.
 *
 * @param {number|string} userId
 */
async function scrubRelatedPii(userId) {
  const statements = [
    `UPDATE addresses SET
       line1 = '[anonymized]', line2 = NULL, city = '[anonymized]',
       state = NULL, postal_code = NULL, phone = NULL
     WHERE user_id = $1`,
    `UPDATE messages SET body = '[anonymized]' WHERE sender_id = $1`,
    `DELETE FROM push_subscriptions WHERE user_id = $1`,
    `DELETE FROM two_factor_recovery_codes WHERE user_id = $1`,
    `DELETE FROM refresh_tokens WHERE user_id = $1`,
    `UPDATE reviews SET comment = NULL WHERE reviewer_id = $1`,
    `UPDATE return_requests SET reason = '[anonymized]' WHERE user_id = $1`,
    `UPDATE waitlist_entries SET email = '[anonymized]' WHERE user_id = $1`,
    `UPDATE share_events SET user_agent = NULL WHERE user_id = $1`,
  ];

  for (const sql of statements) {
    try {
      await db.query(sql, [userId]);
    } catch (e) {
      logger.warn('[anonymize-job] PII scrub skipped', { userId, error: e.message });
    }
  }
}

/**
 * Anonymize PII for users deactivated more than 30 days ago (GDPR).
 * Idempotent: skips rows already anonymized (email matches the anonymized pattern).
 * Custodial Stellar keys (stellar_secret_key and stellar_mnemonic_encrypted) are
 * only destroyed when the user holds no value and has no open obligations that
 * depend on the key.
 *
 * @returns {Promise<{anonymized: number, blocked: number, errors: number}>}
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
  let blocked = 0;
  let errors = 0;

  for (const { id } of rows) {
    try {
      const { blocked: isBlocked, reason } = await checkOpenValueOrObligations(id);

      if (isBlocked) {
        // Do NOT destroy key material while value/obligations remain.
        blocked++;
        await db.query(
          `UPDATE users SET anonymization_blocked_reason = $1 WHERE id = $2`,
          [reason, id]
        );
        logger.warn('[anonymize-job] Skipped user with remaining value/obligations', {
          userId: id,
          reason,
        });
        continue;
      }

      // Anonymize user record and nullify custodial Stellar keys
      await db.query(
        `UPDATE users SET
           name = $1,
           email = $2,
           password = $3,
           stellar_public_key = NULL,
           stellar_secret_key = NULL,
           stellar_mnemonic = NULL,
           stellar_mnemonic_encrypted = NULL,
           two_factor_secret = NULL,
           bio = NULL,
           location = NULL,
           avatar_url = NULL,
           anonymization_blocked_reason = NULL,
           anonymized_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [`Deleted User`, `deleted-${id}@anonymized.invalid`, '[anonymized]', id]
      );

      await scrubRelatedPii(id);
      anonymized++;
    } catch (e) {
      errors++;
      logger.error('[anonymize-job] Failed to anonymize user', { userId: id, error: e.message });
    }
  }

  logger.info('[anonymize-job] Done', { anonymized, blocked, errors });
  return { anonymized, blocked, errors };
}

function startAnonymizeJob() {
  // Run daily at 03:00 UTC
  cron.schedule('0 3 * * *', anonymizeDeactivatedUsers, { scheduled: true, timezone: 'UTC' });
  logger.info('[anonymize-job] Scheduled daily at 03:00 UTC');
}

module.exports = { anonymizeDeactivatedUsers, startAnonymizeJob };
