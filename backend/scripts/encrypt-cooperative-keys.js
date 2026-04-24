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

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!isPlaintext(row.stellar_secret_key)) {
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] Would encrypt cooperative id=${row.id}`);
      encrypted++;
      continue;
    }
    const encryptedKey = await encrypt(row.stellar_secret_key);
    await db.query('UPDATE cooperatives SET stellar_secret_key = $1 WHERE id = $2', [
      encryptedKey,
      row.id,
    ]);
    console.log(`Encrypted cooperative id=${row.id}`);
    encrypted++;
  }

  console.log(`Done. encrypted=${encrypted} skipped=${skipped}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
