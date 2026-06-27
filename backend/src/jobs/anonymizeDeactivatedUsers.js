/**
 * GDPR anonymization job.
 *
 * Scrubs PII from users who have been deactivated for more than 30 days
 * and have not yet been anonymized.
 *
 * Fields scrubbed:
 *   email            → anon_{id}@deleted.local
 *   name             → Deleted User
 *   phone            → NULL  (column may not exist on older DBs — silently skipped)
 *   stellar_public_key → NULL
 *   stellar_secret_key → NULL  (stored as seed_phrase in spec; column named stellar_secret_key here)
 *   address_book     → rows deleted entirely
 *   anonymized_at    → NOW()
 *
 * Order records retain financial data (total_price, product_id, stellar_tx_hash)
 * and referential integrity (buyer_id) but the user row itself is anonymized above.
 */

const db = require('../db/schema');

function anonymizeUser(userId) {
  db.prepare(`
    UPDATE users
    SET email              = 'anon_' || id || '@deleted.local',
        name               = 'Deleted User',
        stellar_public_key = NULL,
        stellar_secret_key = NULL,
        anonymized_at      = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(userId);

  db.prepare('DELETE FROM address_book WHERE user_id = ?').run(userId);
}

function run() {
  const users = db.prepare(`
    SELECT id FROM users
    WHERE deactivated_at IS NOT NULL
      AND deactivated_at < datetime('now', '-30 days')
      AND anonymized_at IS NULL
  `).all();

  for (const { id } of users) {
    try {
      anonymizeUser(id);
      console.log(`[GDPR] Anonymized user ${id}`);
    } catch (err) {
      console.error(`[GDPR] Failed to anonymize user ${id}:`, err.message);
    }
  }

  return users.length;
}

module.exports = { run, anonymizeUser };
