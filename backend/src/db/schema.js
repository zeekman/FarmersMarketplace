/**
 * db/schema.js
 *
 * Dual-mode database layer:
 *   - DATABASE_URL set → PostgreSQL (via pg pool)
 *   - DATABASE_URL unset → SQLite (via better-sqlite3, for local dev)
 *
 * Schema is managed by the migration runner (backend/migrate.js).
 * On startup this module runs all pending migrations automatically.
 *
 * Exports a unified db object:
 *   db.query(sql, params) → Promise<{ rows, rowCount }>
 *   db.isPostgres         → boolean
 */

const Database = require('better-sqlite3');
const path = require('path');

const USE_POSTGRES = !!process.env.DATABASE_URL;

let db;

if (USE_POSTGRES) {
  const pg = require('./postgres');
  // In Postgres mode, the pool is exported directly.
  // The migration runner is usually called from server.js or migrate.js.
  db = pg;
  db.isPostgres = true;
} else {
  let sqlite;
  try {
    sqlite = new Database(path.join(__dirname, '../../market.db'));
  } catch (err) {
    console.error('[DB] Failed to open SQLite database:', err.message);
    process.exit(1);
  }

  // Unified adapter for SQLite to match pg pool interface
  db = {
    async query(text, params = []) {
      // Convert $1, $2, ... placeholders to ? for SQLite
      let i = 0;
      const sqliteText = text.replace(/\$\d+/g, () => {
        i++;
        return '?';
      });

      try {
        if (/^\s*(SELECT|WITH)/i.test(sqliteText)) {
          const rows = sqlite.prepare(sqliteText).all(...params);
          return { rows, rowCount: rows.length };
        }
        const info = sqlite.prepare(sqliteText).run(...params);
        // Better-sqlite3 doesn't support RETURNING easily without polyfills,
        // but it provides lastInsertRowid.
        const returningMatch = text.match(/RETURNING\s+(\w+)/i);
        const rows = returningMatch ? [{ [returningMatch[1]]: info.lastInsertRowid }] : [];
        return { rows, rowCount: info.changes };
      } catch (err) {
        console.error('[DB] SQLite error:', err.message, '| SQL:', sqliteText);
        throw err;
      }
    },
    // For transactions in SQLite
    transaction(fn) {
      return sqlite.transaction(fn);
    },
    // For synchronous access if needed (better-sqlite3 specialized)
    prepare(sql) {
      return sqlite.prepare(sql);
    },
    exec(sql) {
      return sqlite.exec(sql);
    },
    isPostgres: false,
  };
}

module.exports = db;
