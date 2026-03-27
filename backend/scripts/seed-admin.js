/**
 * Creates an admin user from environment variables.
 * Usage: node backend/scripts/seed-admin.js
 * Env vars: ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const name     = process.env.ADMIN_NAME     || 'Admin';
const email    = process.env.ADMIN_EMAIL    || 'admin@farmersmarketplace.com';
const password = process.env.ADMIN_PASSWORD || 'Admin1234!';

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.warn('[seed-admin] ADMIN_EMAIL or ADMIN_PASSWORD not set — using defaults. Set them in .env for production.');
}

const db = new Database(path.join(__dirname, '../market.db'));

// Ensure active column exists
try { db.exec('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1'); } catch {}

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  // Promote to admin if already exists
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email);
  console.log(`[seed-admin] Promoted existing user "${email}" to admin.`);
  process.exit(0);
}

const hashed = bcrypt.hashSync(password, 12);
db.prepare(
  "INSERT INTO users (name, email, password, role, active) VALUES (?, ?, ?, 'admin', 1)"
).run(name, email, hashed);

console.log(`[seed-admin] Admin user created: ${email}`);
process.exit(0);
