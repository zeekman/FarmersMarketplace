const Database = require('better-sqlite3');
const path = require('path');

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
} catch (err) {
  console.error('[DB] Failed to initialize schema:', err.message);
  process.exit(1);
}

// Escrow columns migration
try { db.exec(`ALTER TABLE orders ADD COLUMN escrow_balance_id TEXT`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN escrow_status TEXT DEFAULT 'none'`); } catch {}

// Migrate existing DB: add columns if missing
try { db.exec(`ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN image_url TEXT`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`); } catch {}
// Allow admin role — SQLite doesn't support ALTER COLUMN, so we handle it in auth logic
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN location TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referral_bonus_sent INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5`); } catch {}
try { db.exec(`ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER DEFAULT 0`); } catch {}

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
} catch (err) {
  console.error('[DB] Failed to create reviews table:', err.message);
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
} catch {}

// SQLite doesn't support ALTER COLUMN, so we use a safe workaround via a new table
try {
  const info = db.prepare(`PRAGMA table_info(orders)`).all();
  const hasExtendedStatus = info.some(col => col.name === 'status');
  if (hasExtendedStatus) {
    // Check if the constraint already includes 'delivered' by trying an insert into a temp table
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
    // Only migrate if orders_new is empty (first migration)
    const count = db.prepare(`SELECT COUNT(*) as c FROM orders_new`).get().c;
    if (count === 0) {
      db.exec(`INSERT INTO orders_new SELECT * FROM orders`);
      db.exec(`DROP TABLE orders`);
      db.exec(`ALTER TABLE orders_new RENAME TO orders`);
    } else {
      db.exec(`DROP TABLE orders_new`);
    }
  }
} catch {}

// FTS5 virtual table for full-text product search
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
      name, description, content='products', content_rowid='id'
    );
  `);
} catch (err) {
  console.error('[DB] FTS5 setup failed:', err.message);
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
} catch {}

// Idempotency keys table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key        TEXT PRIMARY KEY,
      response   TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create idempotency_keys table:', err.message);
// stock_alerts table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id),
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
} catch (err) {
  console.error('[DB] Failed to create stock_alerts table:', err.message);
}

module.exports = db;
