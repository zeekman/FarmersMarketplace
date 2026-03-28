#!/usr/bin/env node
/**
 * migrate-sqlite-to-pg.js
 *
 * Transfers all data from the SQLite database (market.db) to PostgreSQL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/dbname node backend/scripts/migrate-sqlite-to-pg.js
 *
 * Prerequisites:
 *   - PostgreSQL database must exist and be reachable via DATABASE_URL
 *   - backend/market.db must exist (SQLite source)
 *   - Run from the repo root or set paths accordingly
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  process.exit(1);
}

const Database = require('better-sqlite3');
const { Pool }  = require('pg');
const path      = require('path');

const sqlitePath = path.join(__dirname, '../market.db');
const sqlite     = new Database(sqlitePath, { readonly: true });
const pg         = new Pool({ connectionString: process.env.DATABASE_URL });

// Tables to migrate in dependency order (parents before children)
const TABLES = [
  'users',
  'refresh_tokens',
  'products',
  'orders',
  'product_images',
  'reviews',
  'favorites',
  'addresses',
  'tags',
  'product_tags',
  'messages',
  'idempotency_keys',
  'stock_alerts',
];

async function migrateTable(tableName) {
  const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
  if (rows.length === 0) {
    console.log(`  [${tableName}] 0 rows — skipped`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const colList = columns.map(c => `"${c}"`).join(', ');
  const sql = `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

  let inserted = 0;
  for (const row of rows) {
    const values = columns.map(c => row[c]);
    await pg.query(sql, values);
    inserted++;
  }
  console.log(`  [${tableName}] ${inserted} rows migrated`);
}

async function resetSequences() {
  // Reset SERIAL sequences so new inserts don't collide with migrated IDs
  const seqTables = ['users', 'refresh_tokens', 'products', 'orders', 'product_images', 'reviews', 'favorites', 'addresses', 'tags', 'messages', 'stock_alerts'];
  for (const t of seqTables) {
    await pg.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
  }
  console.log('  Sequences reset');
}

async function run() {
  console.log(`\nMigrating SQLite → PostgreSQL`);
  console.log(`Source: ${sqlitePath}`);
  console.log(`Target: ${process.env.DATABASE_URL.replace(/:\/\/.*@/, '://<credentials>@')}\n`);

  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      try {
        await migrateTable(table);
      } catch (e) {
        console.warn(`  [${table}] Warning: ${e.message}`);
      }
    }
    await resetSequences();
    await client.query('COMMIT');
    console.log('\nMigration complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nMigration failed, rolled back:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pg.end();
    sqlite.close();
  }
}

run();
