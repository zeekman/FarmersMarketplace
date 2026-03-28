/**
 * db/schema.js
 *
 * Dual-mode database layer:
 *   - If DATABASE_URL is set → PostgreSQL (via pg pool)
 *   - Otherwise             → SQLite (via better-sqlite3, for local dev)
 *
 * Exports a unified `db` object with:
 *   db.query(sql, params)  → Promise<{ rows, rowCount }>
 *   db.isPostgres          → boolean
 *
 * SQLite shim also exposes db.prepare() for backward-compat in routes
 * that haven't been migrated yet (none remain after this migration).
 */

const USE_POSTGRES = !!process.env.DATABASE_URL;

if (USE_POSTGRES) {
  const pg = require('./postgres');

  // Initialize PostgreSQL schema
  async function initSchema() {
    const { query } = pg;
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id                  SERIAL PRIMARY KEY,
        name                TEXT NOT NULL,
        email               TEXT UNIQUE NOT NULL,
        password            TEXT NOT NULL,
        role                TEXT NOT NULL CHECK(role IN ('farmer', 'buyer', 'admin')),
        stellar_public_key  TEXT,
        stellar_secret_key  TEXT,
        active              INTEGER DEFAULT 1,
        bio                 TEXT,
        location            TEXT,
        avatar_url          TEXT,
        referral_code       TEXT UNIQUE,
        federation_name     TEXT UNIQUE,
        referred_by         INTEGER REFERENCES users(id),
        referral_bonus_sent INTEGER DEFAULT 0,
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id                  SERIAL PRIMARY KEY,
        farmer_id           INTEGER NOT NULL REFERENCES users(id),
        name                TEXT NOT NULL,
        description         TEXT,
        category            TEXT DEFAULT 'other',
        price               NUMERIC NOT NULL,
        quantity            INTEGER NOT NULL,
        unit                TEXT DEFAULT 'unit',
        image_url           TEXT,
        low_stock_threshold INTEGER DEFAULT 5,
        low_stock_alerted   INTEGER DEFAULT 0,
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id               SERIAL PRIMARY KEY,
        buyer_id         INTEGER NOT NULL REFERENCES users(id),
        product_id       INTEGER NOT NULL REFERENCES products(id),
        quantity         INTEGER NOT NULL,
        total_price      NUMERIC NOT NULL,
        status           TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','processing','shipped','delivered','failed')),
        stellar_tx_hash  TEXT,
        escrow_balance_id TEXT,
        escrow_status    TEXT DEFAULT 'none',
        address_id       INTEGER,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id         SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        url        TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id         SERIAL PRIMARY KEY,
        order_id   INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comment    TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id         SERIAL PRIMARY KEY,
        buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(buyer_id, product_id)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS addresses (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label       TEXT NOT NULL,
        street      TEXT NOT NULL,
        city        TEXT NOT NULL,
        country     TEXT NOT NULL,
        postal_code TEXT,
        is_default  INTEGER DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS tags (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (product_id, tag_id)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id          SERIAL PRIMARY KEY,
        sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
        content     TEXT NOT NULL,
        read_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key        TEXT PRIMARY KEY,
        response   TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS stock_alerts (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, product_id)
      )
    `);

    console.log('[DB] PostgreSQL schema initialized');
  }

  initSchema().catch((err) => {
    console.error('[DB] Failed to initialize PostgreSQL schema:', err.message);
    process.exit(1);
  });

  module.exports = pg;

} else {
  // ── SQLite fallback for local development ──────────────────────────────────
  const Database = require('better-sqlite3');
  const path = require('path');

  let sqlite;
  try {
    sqlite = new Database(path.join(__dirname, '../../market.db'));
  } catch (err) {
    console.error('[DB] Failed to open SQLite database:', err.message);
    process.exit(1);
  }

  // Run all SQLite DDL (unchanged from original)
  try {
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (farmer_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        total_price REAL NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','processing','shipped','delivered','failed')),
        stellar_tx_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
    `);
  } catch (err) {
    console.error('[DB] Failed to initialize SQLite schema:', err.message);
    process.exit(1);
  }

  // Incremental migrations (safe — catch ignores already-exists errors)
  const migrations = [
    `ALTER TABLE orders ADD COLUMN escrow_balance_id TEXT`,
    `ALTER TABLE orders ADD COLUMN escrow_status TEXT DEFAULT 'none'`,
    `ALTER TABLE orders ADD COLUMN address_id INTEGER REFERENCES addresses(id)`,
    `ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`,
    `ALTER TABLE products ADD COLUMN image_url TEXT`,
    `ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`,
    `ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN bio TEXT`,
    `ALTER TABLE users ADD COLUMN location TEXT`,
    `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
    `ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`,
    `ALTER TABLE users ADD COLUMN federation_name TEXT UNIQUE`,
    `ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)`,
    `ALTER TABLE users ADD COLUMN referral_bonus_sent INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE,
      buyer_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(buyer_id, product_id),
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      street TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      postal_code TEXT,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_tags (
      product_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (product_id, tag_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      product_id INTEGER,
      content TEXT NOT NULL,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stock_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create idempotency_keys table:', err.message);
}
// stock_alerts table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
      name, description, content='products', content_rowid='id'
    )`,
    `CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
      INSERT INTO products_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
    END`,
    `CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
      INSERT INTO products_fts(products_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
    END`,
    `CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
      INSERT INTO products_fts(products_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
      INSERT INTO products_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
    END`,
  ];

  for (const sql of migrations) {
    try { sqlite.exec(sql); } catch {}
  }

  // Expose a pg-compatible async query() alongside the synchronous sqlite object
  sqlite.query = async (text, params = []) => {
    // Convert $1,$2,... placeholders to ? for SQLite
    let i = 0;
    const sqliteText = text.replace(/\$\d+/g, () => { i++; return '?'; });
    try {
      if (/^\s*(SELECT|WITH)/i.test(sqliteText)) {
        const rows = sqlite.prepare(sqliteText).all(...params);
        return { rows, rowCount: rows.length };
      } else {
        const info = sqlite.prepare(sqliteText).run(...params);
        // Emulate RETURNING id
        const returning = text.match(/RETURNING\s+(\w+)/i);
        const rows = returning ? [{ [returning[1]]: info.lastInsertRowid }] : [];
        return { rows, rowCount: info.changes };
      }
    } catch (err) {
      throw err;
    }
  };

  sqlite.isPostgres = false;
  module.exports = sqlite;
}
// Subscriptions table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id      INTEGER NOT NULL,
      product_id    INTEGER NOT NULL,
      quantity      INTEGER NOT NULL,
      frequency     TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly')),
      next_order_at DATETIME NOT NULL,
      active        INTEGER NOT NULL DEFAULT 1,
      status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled')),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id)   REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create subscriptions table:', err.message);
// Bundles tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bundle_items (
      bundle_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      PRIMARY KEY (bundle_id, product_id),
      FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bundle_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      bundle_id INTEGER NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed')),
      stellar_tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (bundle_id) REFERENCES bundles(id)
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create bundles tables:', err.message);
}

module.exports = db;
