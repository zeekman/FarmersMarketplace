/**
 * Creates an admin user from environment variables.
 * Usage: node backend/scripts/seed-admin.js
 * Env vars: ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
 * Supports both SQLite (default) and PostgreSQL (when DATABASE_URL is set).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');

const name     = process.env.ADMIN_NAME     || 'Admin';
const email    = process.env.ADMIN_EMAIL    || 'admin@farmersmarketplace.com';
const password = process.env.ADMIN_PASSWORD || 'Admin1234!';

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.warn('[seed-admin] ADMIN_EMAIL or ADMIN_PASSWORD not set — using defaults.');
}

async function run() {
  const hashed = bcrypt.hashSync(password, 12);

  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (rows[0]) {
      await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
      console.log(`[seed-admin] Promoted existing user "${email}" to admin.`);
    } else {
      await pool.query("INSERT INTO users (name, email, password, role, active) VALUES ($1,$2,$3,'admin',1)", [name, email, hashed]);
      console.log(`[seed-admin] Admin user created: ${email}`);
    }
    await pool.end();
  } else {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, '../market.db'));
    try { db.exec('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1'); } catch {}
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email);
      console.log(`[seed-admin] Promoted existing user "${email}" to admin.`);
    } else {
      db.prepare("INSERT INTO users (name, email, password, role, active) VALUES (?, ?, ?, 'admin', 1)").run(name, email, hashed);
      console.log(`[seed-admin] Admin user created: ${email}`);
    }
  }
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
