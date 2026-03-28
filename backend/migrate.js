#!/usr/bin/env node
/**
 * migrate.js — CLI migration runner
 *
 * Usage:
 *   npm run migrate              # apply all pending migrations
 *   npm run migrate:rollback     # revert the last applied migration
 *
 * Migration files: backend/migrations/NNN_description.sql
 * Rollback files:  backend/migrations/NNN_description.undo.sql
 *
 * Applied migrations are tracked in a `migrations` table.
 * Running migrate twice is safe — already-applied migrations are skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs   = require('fs');
const path = require('path');
const { runMigrations, ensureMigrationsTable, getApplied } = require('./src/db/migrationRunner');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const USE_POSTGRES   = !!process.env.DATABASE_URL;

async function getAdapter() {
  if (USE_POSTGRES) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return {
      async query(sql, params = []) { return pool.query(sql, params); },
      async exec(sql)               { return pool.query(sql); },
      async close()                 { await pool.end(); },
      placeholder: (i) => `$${i}`,
      isPostgres: true,
    };
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(__dirname, 'market.db'));
    return {
      async query(sql, params = []) {
        if (/^\s*(SELECT|WITH)/i.test(sql)) {
          return { rows: db.prepare(sql).all(...params) };
        }
        const info = db.prepare(sql).run(...params);
        return { rows: [], rowCount: info.changes };
      },
      async exec(sql) { db.exec(sql); },
      async close()   { db.close(); },
      placeholder: () => '?',
      isPostgres: false,
    };
  }
}

async function rollback() {
  const db = await getAdapter();
  await ensureMigrationsTable(db);
  const applied = await getApplied(db);

  if (applied.size === 0) {
    console.log('[migrate] Nothing to roll back.');
    await db.close();
    return;
  }

  const last     = [...applied].sort().at(-1);
  const undoName = last.replace(/\.sql$/, '.undo.sql');
  const undoPath = path.join(MIGRATIONS_DIR, undoName);

  if (!fs.existsSync(undoPath)) {
    console.error(`[migrate] No rollback file found: ${undoName}`);
    await db.close();
    process.exit(1);
  }

  console.log(`[migrate] Rolling back ${last}...`);
  const sql = fs.readFileSync(undoPath, 'utf8');
  await db.exec(sql);

  const p = db.placeholder(1);
  await db.query(`DELETE FROM migrations WHERE name = ${p}`, [last]);
  console.log(`[migrate] ✓ Rolled back ${last}`);
  await db.close();
}

async function migrate() {
  const db = await getAdapter();
  await runMigrations(db);
  await db.close();
}

const command = process.argv[2];
(command === 'rollback' ? rollback() : migrate()).catch(err => {
  console.error('[migrate] Error:', err.message);
  process.exit(1);
});
