/**
 * One-off data migration: encrypts any plaintext users.stellar_mnemonic values with
 * AES-256-GCM (backend/src/utils/crypto.js) and marks them via stellar_mnemonic_encrypted.
 * Run after applying migration 013_encrypt_stellar_mnemonic.sql.
 *
 * Usage: node backend/scripts/encrypt-stellar-mnemonics.js
 * Requires: DB_ENCRYPTION_KEY set in the environment.
 * Supports both SQLite (default) and PostgreSQL (when DATABASE_URL is set).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { encrypt } = require('../src/utils/crypto');

async function run() {
  if (!process.env.DB_ENCRYPTION_KEY) {
    console.error('[encrypt-stellar-mnemonics] DB_ENCRYPTION_KEY is not set. Aborting.');
    process.exit(1);
  }

  let adapter;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    adapter = {
      select: () => pool.query(
        'SELECT id, stellar_mnemonic FROM users WHERE stellar_mnemonic IS NOT NULL AND stellar_mnemonic_encrypted = 0'
      ).then((r) => r.rows),
      update: (id, value) => pool.query(
        'UPDATE users SET stellar_mnemonic = $1, stellar_mnemonic_encrypted = 1 WHERE id = $2',
        [value, id]
      ),
      close: () => pool.end(),
    };
  } else {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, '../market.db'));
    adapter = {
      select: () => db
        .prepare(
          'SELECT id, stellar_mnemonic FROM users WHERE stellar_mnemonic IS NOT NULL AND stellar_mnemonic_encrypted = 0'
        )
        .all(),
      update: (id, value) => db
        .prepare('UPDATE users SET stellar_mnemonic = ?, stellar_mnemonic_encrypted = 1 WHERE id = ?')
        .run(value, id),
      close: () => db.close(),
    };
  }

  const rows = await adapter.select();
  let migrated = 0;
  for (const row of rows) {
    // A previously-encrypted value looks like "base64:base64:base64" (see crypto.js);
    // skip anything that already matches that shape defensively.
    if (/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(row.stellar_mnemonic)) {
      continue;
    }
    const ciphertext = encrypt(row.stellar_mnemonic);
    await adapter.update(row.id, ciphertext);
    migrated += 1;
  }

  console.log(`[encrypt-stellar-mnemonics] Encrypted ${migrated} of ${rows.length} plaintext mnemonic(s).`);
  await adapter.close();
}

run().catch((e) => {
  console.error('[encrypt-stellar-mnemonics] Failed:', e.message);
  process.exit(1);
});
