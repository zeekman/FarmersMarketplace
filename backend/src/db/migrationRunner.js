/**
 * migrationRunner.js
 *
 * Shared migration logic used by both:
 *   - src/db/schema.js (auto-run on app startup)
 *   - migrate.js (CLI tool)
 *
 * Expects a db adapter with:
 *   db.query(sql, params?) → Promise<{ rows }>
 *   db.exec(sql)           → Promise<void>
 *   db.isPostgres          → boolean
 *   db.placeholder(i)      → '$i' | '?'
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

async function ensureMigrationsTable(db) {
  if (db.isPostgres) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}

async function getApplied(db) {
  const { rows } = await db.query('SELECT name FROM migrations ORDER BY name ASC');
  return new Set(rows.map((r) => r.name));
}

function getPendingFiles(applied, migrationsDir = MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f) && !f.endsWith('.undo.sql'))
    .sort()
    .filter((f) => !applied.has(f));
}

async function runMigrations(db, migrationsDir = MIGRATIONS_DIR) {
  await ensureMigrationsTable(db);
  const applied = await getApplied(db);
  const pending = getPendingFiles(applied, migrationsDir);

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    const p = db.placeholder ? db.placeholder(1) : '$1';
    await db.query(`INSERT INTO migrations (name) VALUES (${p})`, [file]);
    logger.info(`[migrate] Applied ${file}`);
  }

  if (pending.length > 0) {
    logger.info(`[migrate] ${pending.length} migration(s) applied.`);
  }
}

module.exports = { runMigrations, ensureMigrationsTable, getApplied, getPendingFiles };
