#!/usr/bin/env node
/**
 * scripts/encrypt-cooperative-keys.js
 *
 * One-off data migration: encrypts any plaintext stellar_secret_key values
 * in the cooperatives table using AES-256-GCM (ENCRYPTION_SECRET).
 *
 * Usage:
 *   node scripts/encrypt-cooperative-keys.js           # encrypt plaintext keys
 *   node scripts/encrypt-cooperative-keys.js --dry-run # preview without writing
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../src/db/schema');
const { encrypt, isPlaintext } = require('../src/utils/crypto');

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  const { rows } = await db.query(
    'SELECT id, stellar_secret_key FROM cooperatives WHERE stellar_secret_key IS NOT NULL'
  );

  const toEncrypt = rows.filter(r => isPlaintext(r.stellar_secret_key));
  const skipped = rows.length - toEncrypt.length;

  if (dryRun) {
    for (const row of toEncrypt) {
      console.log(`[dry-run] Would encrypt cooperative id=${row.id}`);
    }
    console.log(`Done (dry-run). total=${toEncrypt.length} skipped=${skipped}`);
    process.exit(0);
  }

  let succeeded = 0;
  const failures = [];

  // Pre-encrypt all keys before opening the transaction so async crypto
  // doesn't run inside a synchronous SQLite transaction.
  const updates = [];
  for (const row of toEncrypt) {
    try {
      const encryptedKey = await encrypt(row.stellar_secret_key);
      updates.push({ id: row.id, encryptedKey });
    } catch (err) {
      failures.push({ id: row.id, error: err.message });
    }
  }

  if (db.isPostgres) {
    // PostgreSQL: use a real transaction
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const { id, encryptedKey } of updates) {
        await client.query('UPDATE cooperatives SET stellar_secret_key = $1 WHERE id = $2', [encryptedKey, id]);
        console.log(`Encrypted cooperative id=${id}`);
        succeeded++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Transaction rolled back:', err.message);
      process.exit(1);
    } finally {
      client.release();
    }
  } else {
    // SQLite: use better-sqlite3 synchronous transaction
    const runUpdates = db.transaction
      ? db.transaction(() => {
          for (const { id, encryptedKey } of updates) {
            db.prepare('UPDATE cooperatives SET stellar_secret_key = ? WHERE id = ?').run(encryptedKey, id);
          }
        })
      : null;

    if (runUpdates) {
      try {
        runUpdates();
        for (const { id } of updates) {
          console.log(`Encrypted cooperative id=${id}`);
          succeeded++;
        }
      } catch (err) {
        console.error('Transaction rolled back:', err.message);
        process.exit(1);
      }
    } else {
      // Fallback: no transaction support exposed
      for (const { id, encryptedKey } of updates) {
        try {
          await db.query('UPDATE cooperatives SET stellar_secret_key = $1 WHERE id = $2', [encryptedKey, id]);
          console.log(`Encrypted cooperative id=${id}`);
          succeeded++;
        } catch (err) {
          failures.push({ id, error: err.message });
        }
      }
    }
  }

  for (const { id, error } of failures) {
    console.error(`Failed cooperative id=${id}: ${error}`);
  }

  console.log(
    `Done. total=${toEncrypt.length} succeeded=${succeeded} failed=${failures.length} skipped=${skipped}`
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
