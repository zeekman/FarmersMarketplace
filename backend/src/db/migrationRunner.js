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
    .filter(
      (f) =>
        /^\d+_.+\.sql$/.test(f) &&
        !f.endsWith('.undo.sql') &&
        !/\.(?:postgres|sqlite)\.sql$/.test(f)
    )
    .sort()
    .filter((f) => !applied.has(f));
}

function getMigrationFile(file, dialect, migrationsDir = MIGRATIONS_DIR) {
  const base = file.slice(0, -4);
  const candidates = [
    path.join(migrationsDir, `${base}.${dialect}.sql`),
    path.join(migrationsDir, `${base}.${dialect}`),
    path.join(migrationsDir, file),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function runMigrations(db, migrationsDir = MIGRATIONS_DIR) {
  await ensureMigrationsTable(db);
  const applied = await getApplied(db);
  const pending = getPendingFiles(applied, migrationsDir);

  for (const file of pending) {
    const dialect = db.isPostgres ? 'postgres' : 'sqlite';
    try {
      const sqlFile = getMigrationFile(file, dialect, migrationsDir);
      const sql = fs.readFileSync(sqlFile, 'utf8');
      await db.exec(sql);
      if (file === '034_reviews_schema.sql') {
        await ensureReviewSchema(db);
      }
      const p = db.placeholder ? db.placeholder(1) : '$1';
      await db.query(`INSERT INTO migrations (name) VALUES (${p})`, [file]);
      logger.info(`[migrate] Applied ${file}`);
    } catch (err) {
      throw new Error(`[migrate] Failed migration ${file}: ${err.message}`, { cause: err });
    }
  }

  if (pending.length > 0) {
    logger.info(`[migrate] ${pending.length} migration(s) applied.`);
  }
}

async function ensureReviewSchema(db) {
  const columnsFor = async (table) => {
    const sql = db.isPostgres
      ? 'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1'
      : `SELECT name FROM pragma_table_info('${table}')`;
    const { rows } = await db.query(sql, db.isPostgres ? [table] : []);
    return new Set(rows.map(({ name }) => name));
  };

  const productColumns = await columnsFor('products');
  const reviewColumns = await columnsFor('reviews');

  const additions = [
    ['products', productColumns, 'avg_rating', 'REAL DEFAULT 0'],
    ['products', productColumns, 'review_count', 'INTEGER DEFAULT 0'],
    ['reviews', reviewColumns, 'order_id', 'INTEGER REFERENCES orders(id) ON DELETE CASCADE'],
    ['reviews', reviewColumns, 'comment', 'TEXT'],
    [
      'reviews',
      reviewColumns,
      'status',
      "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected'))",
    ],
  ];

  for (const [table, columns, name, definition] of additions) {
    if (!columns.has(name)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }

  if (reviewColumns.has('body') && !reviewColumns.has('comment')) {
    await db.query('UPDATE reviews SET comment = body WHERE comment IS NULL AND body IS NOT NULL');
  }

  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_order_id ON reviews(order_id) WHERE order_id IS NOT NULL'
  );
}

module.exports = {
  runMigrations,
  ensureMigrationsTable,
  getApplied,
  getPendingFiles,
  getMigrationFile,
  ensureReviewSchema,
};
