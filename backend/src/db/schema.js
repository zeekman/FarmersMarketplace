/**
 * db/schema.js
 *
 * Dual-mode database layer:
 *   - DATABASE_URL set → PostgreSQL (via pg pool)
 *   - DATABASE_URL unset → SQLite (via better-sqlite3, for local dev)
 *
 * Schema is managed by the migration runner (backend/migrate.js).
 * The complete migration filename is its identity; numeric prefixes in the
 * historical migration set are not unique.
 * `ready` resolves when startup migrations have completed.
 *
 * Exports a unified db object:
 *   db.query(sql, params) → Promise<{ rows, rowCount }>
 *   db.exec(sql)           → Promise<void>  (DDL / multi-statement)
 *   db.withTransaction(fn) → Promise<result> (fn receives a connection-scoped query adapter)
 *   db.ready               → Promise<void>  (startup migrations)
 *   db.isPostgres         → boolean
 *
 * Boolean normalization: SQLite stores booleans as 0/1 integers, PostgreSQL as true/false.
 * This layer normalizes both to consistent boolean values for the active column.
 */

const path = require('path');
const logger = require('../logger');

const USE_POSTGRES = !!process.env.DATABASE_URL;

/**
 * Normalize boolean values in a row for consistency across SQLite and PostgreSQL.
 * Converts 0/1 integers and string representations to proper booleans.
 */
function normalizeBooleans(row) {
  if (!row || typeof row !== 'object') return row;

  const normalized = { ...row };
  const booleanColumns = ['active', 'fee_bumped', 'is_preorder', 'low_stock_alerted', 'acknowledged', 'success'];

  for (const col of booleanColumns) {
    if (col in normalized) {
      const val = normalized[col];
      if (val === null || val === undefined) {
        normalized[col] = null;
      } else if (typeof val === 'boolean') {
        normalized[col] = val;
      } else if (typeof val === 'number') {
        normalized[col] = val !== 0;
      } else if (typeof val === 'string') {
        normalized[col] = val === 'true' || val === '1';
      }
    }
  }

  return normalized;
}

if (USE_POSTGRES) {
  const pg = require('./postgres');
  const { runMigrations } = require('./migrationRunner');

  const normalizeResult = (result) => {
    if (result.rows && Array.isArray(result.rows)) {
      result.rows = result.rows.map((row) => normalizeBooleans(row));
    }
    return result;
  };

  const db = {
    query: async (text, params) => {
      return normalizeResult(await pg.query(text, params));
    },
    async exec(sql) {
      await pg.query(sql);
    },
    async withTransaction(work) {
      const client = await pg.connect();
      let started = false;
      try {
        await client.query('BEGIN');
        started = true;
        const result = await work({
          query: async (text, params) => normalizeResult(await client.query(text, params)),
        });
        await client.query('COMMIT');
        started = false;
        return result;
      } catch (error) {
        if (started) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Transaction failed and rollback could not be completed');
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
    isPostgres: true,
    placeholder: (i) => `$${i}`,
    getClient: () => pg.connect(),
    getStats: () => pg.getStats(),
    close: () => pg.end(),
  };

  db.ready = runMigrations(db);
  db.ready.catch((err) => logger.error('[DB] Migration failed:', { error: err.message }));
  module.exports = db;
} else {
  const Database = require('better-sqlite3');
  const { AsyncLocalStorage } = require('async_hooks');

  let sqlite;
  try {
    // SQLITE_PATH=:memory: lets CI boot the server without leaving a file behind
    sqlite = new Database(process.env.SQLITE_PATH || path.join(__dirname, '../../market.db'), {
      timeout: parseInt(process.env.DB_QUERY_TIMEOUT_SQLITE || '5000', 10),
    });
  } catch (err) {
    logger.error('[DB] Failed to open SQLite database:', { error: err.message });
    process.exit(1);
  }

  const transactionStorage = new AsyncLocalStorage();
  let activeTransaction = null;
  let transactionQueue = Promise.resolve();
  const transactionWaiters = [];

  const waitForTransaction = async () => {
    const transaction = transactionStorage.getStore();
    while (activeTransaction && transaction !== activeTransaction) {
      await new Promise((resolve) => transactionWaiters.push(resolve));
    }
  };

  const querySqlite = (sql, params = []) => {
    const text = sql.replace(/\$\d+/g, '?');
    if (/^\s*(SELECT|WITH)/i.test(text)) {
      const rows = sqlite.prepare(text).all(...params);
      return { rows: rows.map(normalizeBooleans), rowCount: rows.length };
    }
    if (/\bRETURNING\b/i.test(text)) {
      const row = sqlite.prepare(text).get(...params);
      return { rows: row ? [normalizeBooleans(row)] : [], rowCount: row ? 1 : 0 };
    }
    const info = sqlite.prepare(text).run(...params);
    return { rows: [], rowCount: info.changes };
  };

  const db = {
    async query(sql, params = []) {
      await waitForTransaction();
      return querySqlite(sql, params);
    },
    async exec(sql) {
      await waitForTransaction();
      sqlite.exec(sql);
    },
    async withTransaction(work) {
      let release;
      const previousTransaction = transactionQueue;
      transactionQueue = new Promise((resolve) => {
        release = resolve;
      });
      await previousTransaction;

      const transaction = {};
      activeTransaction = transaction;
      let started = false;
      try {
        sqlite.exec('BEGIN IMMEDIATE');
        started = true;
        const result = await transactionStorage.run(transaction, () => work(db));
        sqlite.exec('COMMIT');
        started = false;
        return result;
      } catch (error) {
        if (started) {
          try {
            sqlite.exec('ROLLBACK');
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Transaction failed and rollback could not be completed');
          }
        }
        throw error;
      } finally {
        activeTransaction = null;
        release();
        for (const resolve of transactionWaiters.splice(0)) resolve();
      }
    },
    isPostgres: false,
    placeholder: () => '?',
    close: async () => sqlite.close(),
  };

  const { runMigrations } = require('./migrationRunner');
  db.ready = runMigrations(db);
  db.ready.catch((err) => logger.error('[DB] Migration failed:', { error: err.message }));
  module.exports = db;
}
