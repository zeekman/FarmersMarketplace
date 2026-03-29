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

let db;
try {
  db = new Database(path.join(__dirname, '../../market.db'));
} catch (err) {
  console.error('[DB] Failed to open SQLite database:', err.message);
  process.exit(1);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('farmer', 'buyer')),
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id)
    );
  `);
} catch (err) {
  console.error('[DB] Failed to initialize schema:', err.message);
}

const USE_POSTGRES = !!process.env.DATABASE_URL;

if (USE_POSTGRES) {
  const pg = require('./postgres');

  // Run migrations on startup then export the pool
  const { runMigrations } = require('./migrationRunner');
  runMigrations(pg).catch(err => {
    console.error('[DB] Migration failed:', err.message);
    process.exit(1);
  });

// Migrate existing DB: add columns if missing
try { db.exec(`ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN image_url TEXT`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN is_preorder INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN preorder_delivery_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`); } catch {}
// Allow admin role — SQLite doesn't support ALTER COLUMN, so we handle it in auth logic
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN location TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN federation_name TEXT UNIQUE`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referral_bonus_sent INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN stellar_mnemonic TEXT`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`); } catch {}
  module.exports = pg;

} else {
  const Database = require('better-sqlite3');
  const path     = require('path');

  let sqlite;
  try {
    sqlite = new Database(path.join(__dirname, '../../market.db'));
  } catch (err) {
    console.error('[DB] Failed to open SQLite database:', err.message);
    process.exit(1);
  }

  // Build a SQLite adapter compatible with the migration runner
  const sqliteAdapter = {
    async query(sql, params = []) {
      let i = 0;
      const text = sql.replace(/\$\d+/g, () => { i++; return '?'; });
      if (/^\s*(SELECT|WITH)/i.test(text)) {
        const rows = sqlite.prepare(text).all(...params);
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
    `ALTER TABLE products ADD COLUMN carbon_kg_per_unit REAL`,
    `ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`,
    `ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN verification_status TEXT DEFAULT 'unverified'`,
    `ALTER TABLE users ADD COLUMN verification_docs TEXT`,
    `ALTER TABLE users ADD COLUMN bio TEXT`,
    `ALTER TABLE users ADD COLUMN location TEXT`,
    `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
    `ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`,
    `ALTER TABLE users ADD COLUMN federation_name TEXT UNIQUE`,
    `ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)`,
    `ALTER TABLE users ADD COLUMN referral_bonus_sent INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN stellar_mnemonic TEXT`,
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
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`
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
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE    )`,
    `CREATE TABLE IF NOT EXISTS price_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      min_quantity INTEGER NOT NULL CHECK(min_quantity > 0),
      price_per_unit REAL NOT NULL CHECK(price_per_unit > 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, min_quantity)    )`,
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
    `CREATE TABLE IF NOT EXISTS coupons (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code           TEXT NOT NULL UNIQUE,
      discount_type  TEXT NOT NULL CHECK(discount_type IN ('percent', 'fixed')),
      discount_value REAL NOT NULL CHECK(discount_value > 0),
      max_uses       INTEGER,
      used_count     INTEGER NOT NULL DEFAULT 0,
      expires_at     DATETIME,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS crop_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL CHECK(alert_type IN ('pest', 'disease', 'weather', 'other')),
      description TEXT NOT NULL,
      location TEXT,
      latitude REAL,
      longitude REAL,
      severity TEXT DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE products ADD COLUMN grade TEXT DEFAULT 'Ungraded' CHECK(grade IN ('A','B','C','Ungraded'))`,
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
      }
      const info = sqlite.prepare(text).run(...params);
      const returning = sql.match(/RETURNING\s+(\w+)/i);
      const rows = returning ? [{ [returning[1]]: info.lastInsertRowid }] : [];
      return { rows, rowCount: info.changes };
    },
    async exec(sql) { sqlite.exec(sql); },
    isPostgres: false,
    placeholder: () => '?',
  };

  // Run migrations synchronously at startup (SQLite is sync-friendly)
  const { runMigrations } = require('./migrationRunner');
  runMigrations(sqliteAdapter).catch(err => {
    console.error('[DB] Migration failed:', err.message);
    process.exit(1);
  });

  // Expose pg-compatible async query() on the sqlite instance
  sqlite.query     = sqliteAdapter.query;
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

// account_alerts table — placeholder kept for branch compatibility
// availability_calendar table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS availability_calendar (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      available  INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, week_start),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create availability_calendar table:', err.message);
// cooperatives + multisig tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cooperatives (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      stellar_public_key TEXT,
      stellar_secret_key TEXT,
      multisig_threshold INTEGER NOT NULL DEFAULT 1,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cooperative_members (
      cooperative_id INTEGER NOT NULL,
      user_id        INTEGER NOT NULL,
      PRIMARY KEY (cooperative_id, user_id),
      FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pending_transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      cooperative_id INTEGER NOT NULL,
      initiator_id   INTEGER NOT NULL,
      xdr            TEXT NOT NULL,
      amount         REAL NOT NULL,
      destination    TEXT NOT NULL,
      memo           TEXT,
      signatures     TEXT NOT NULL DEFAULT '[]',
      status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','expired','cancelled')),
      expires_at     DATETIME NOT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE CASCADE,
      FOREIGN KEY (initiator_id)   REFERENCES users(id)
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create cooperative tables:', err.message);
// account_alerts table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      read_at    DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create account_alerts table:', err.message);
}

module.exports = db;
