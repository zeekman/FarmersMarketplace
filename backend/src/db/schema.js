const path = require('path');

if (process.env.DATABASE_URL) {
  module.exports = require('./postgres');
} else {
  const Database = require('better-sqlite3');
  const sqlite = new Database(path.join(__dirname, '../../market.db'));

  function hasColumn(tableName, columnName) {
    const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
  }

  function ensureSchema() {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('farmer', 'buyer', 'admin')),
        stellar_public_key TEXT,
        stellar_secret_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'other',
        price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        unit TEXT DEFAULT 'unit',
        image_url TEXT,
        is_preorder INTEGER DEFAULT 0,
        preorder_delivery_date TEXT,
        low_stock_threshold INTEGER DEFAULT 5,
        low_stock_alerted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (farmer_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        total_price REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        stellar_tx_hash TEXT,
        escrow_balance_id TEXT,
        escrow_status TEXT DEFAULT 'none',
        address_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE TABLE IF NOT EXISTS stock_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );
    `);

    const userColumnMigrations = [
      ['active', 'INTEGER DEFAULT 1'],
      ['bio', 'TEXT'],
      ['location', 'TEXT'],
      ['avatar_url', 'TEXT'],
      ['referral_code', 'TEXT'],
      ['federation_name', 'TEXT'],
      ['referred_by', 'INTEGER'],
      ['referral_bonus_sent', 'INTEGER DEFAULT 0'],
    ];

    for (const [columnName, definition] of userColumnMigrations) {
      if (!hasColumn('users', columnName)) {
        try {
          sqlite.exec(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
        } catch (_err) {}
      }
    }
  }

  ensureSchema();

  module.exports = {
    isPostgres: false,
    prepare(sql) {
      return sqlite.prepare(sql);
    },
    exec(sql) {
      return sqlite.exec(sql);
    },
    transaction(fn) {
      return sqlite.transaction(fn);
    },
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\$\d+/g, '?');
      const values = Array.isArray(params) ? params : [params];
      const stmt = sqlite.prepare(normalized);

      if (/^\s*(SELECT|WITH)/i.test(normalized)) {
        const rows = stmt.all(...values);
        return { rows, rowCount: rows.length };
      }

      if (/\bRETURNING\b/i.test(normalized)) {
        const row = stmt.get(...values);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      const result = stmt.run(...values);
      return { rows: [], rowCount: result.changes ?? 0 };
    },
  };
}
