const Database = require('better-sqlite3');
const path = require('path');

let db;
try {
  db = new Database(path.join(__dirname, '../../market.db'));
} catch (dbErr) {
  console.warn('[DB] Failed to open SQLite database:', dbErr.message);
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'failed')),
      stellar_tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
} catch (schemaErr) {
  console.warn('[DB] Failed to initialize schema:', schemaErr.message);
  process.exit(1);
}

// Migrate existing DB: add columns if missing
const migrations = [
  `ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`,
  `ALTER TABLE products ADD COLUMN image_url TEXT`,
  `ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`,
  `ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`,
  `ALTER TABLE users ADD COLUMN bio TEXT`,
  `ALTER TABLE users ADD COLUMN location TEXT`,
  `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
  `ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`,
  `ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)`,
  `ALTER TABLE users ADD COLUMN referral_bonus_sent INTEGER DEFAULT 0`,
];
for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch {
    // Column already exists — safe to ignore
  }
}

// Reviews table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL UNIQUE,
      buyer_id   INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment    TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
      FOREIGN KEY (buyer_id)   REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
} catch (reviewErr) {
  console.warn('[DB] Failed to create reviews table:', reviewErr.message);
}

// Migrate orders: recreate with extended status CHECK if needed
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'failed')),
      stellar_tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
  const count = db.prepare(`SELECT COUNT(*) as c FROM orders_new`).get().c;
  if (count === 0) {
    db.exec(`INSERT INTO orders_new SELECT * FROM orders`);
    db.exec(`DROP TABLE orders`);
    db.exec(`ALTER TABLE orders_new RENAME TO orders`);
  } else {
    db.exec(`DROP TABLE orders_new`);
  }
} catch {
  // Migration already done or not needed
}

// FTS5 virtual table for full-text product search
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
      name, description, content='products', content_rowid='id'
    );
  `);
} catch (ftsErr) {
  console.warn('[DB] FTS5 setup failed:', ftsErr.message);
}

// Triggers to keep FTS in sync with products
try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
      INSERT INTO products_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
      INSERT INTO products_fts(products_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
    END;

    CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
      INSERT INTO products_fts(products_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
      INSERT INTO products_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
    END;
  `);
} catch {
  // Triggers already exist
}

module.exports = db;
