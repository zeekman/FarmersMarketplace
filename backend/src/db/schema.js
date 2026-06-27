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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deactivated_at DATETIME,
    anonymized_at DATETIME
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
    restock_notified_at DATETIME,
    FOREIGN KEY (farmer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed')),
    stellar_tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS favourites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS waitlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    endpoint TEXT NOT NULL,
    subscription_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS address_book (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT,
    address TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Migrate existing DB: add columns if missing
const migrations = [
  `ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`,
  `ALTER TABLE products ADD COLUMN restock_notified_at DATETIME`,
  `ALTER TABLE users ADD COLUMN deactivated_at DATETIME`,
  `ALTER TABLE users ADD COLUMN anonymized_at DATETIME`,
];
for (const sql of migrations) { try { db.exec(sql); } catch {} }

module.exports = db;

