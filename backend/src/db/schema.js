const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../market.db'));

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

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farmer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'other',
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    unit TEXT DEFAULT 'unit',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farmer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    weight REAL,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed')),
    stellar_tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// Migrate existing DB: add category column if missing
try { db.exec(`ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`); } catch {}
// Migrate: add grade column if missing
try { db.exec(`ALTER TABLE products ADD COLUMN grade TEXT`); } catch (e) {}

// Migrate: add weight column to orders if missing
try { 
  db.exec(`ALTER TABLE orders ADD COLUMN weight REAL`);
} catch (e) {}

// Create idempotency cache table
db.exec(`
  CREATE TABLE IF NOT EXISTS idempotency (
    \`key\` TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    body TEXT NOT NULL,
    expires DATETIME NOT NULL DEFAULT (datetime('now', '+24 hours'))
  )
`);

// Cleanup expired cache entries on startup
try {
  db.exec('DELETE FROM idempotency WHERE expires < datetime("now")');
} catch (e) {}

module.exports = db;

