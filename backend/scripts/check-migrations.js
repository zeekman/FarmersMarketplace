#!/usr/bin/env node
/**
 * check-migrations.js — guards the integrity of backend/migrations/.
 *
 * Migrations are ordered by their full filename (see src/db/migrationRunner.js),
 * so a repeated numeric prefix makes ordering depend on the description text,
 * which is fragile when migrations depend on each other. This script fails when:
 *
 *   1. a prefix at or above the next free prefix is used more than once;
 *   2. a forward migration has no matching `.undo.sql` rollback file;
 *   3. a dialect overlay (`*.postgres.sql`) has no base `.sql` migration.
 *
 * The duplicate prefixes that already exist in the repository are immutable
 * migration identities (a migration is identified by its complete filename) and
 * are exempt by design.
 *
 * Usage: node scripts/check-migrations.js
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// The next prefix that has never been used. Everything at or above it must have
// a unique prefix and must ship a rollback file.
const NEXT_FREE_PREFIX = 42;

// Duplicate prefixes that already exist in the repository. The complete filename
// is the migration identity, so these duplicates are permanent and must never be
// renamed or renumbered. 036 and 041 were missing from the older README list and
// are recorded here explicitly.
const ALLOWED_DUPLICATE_PREFIXES = new Set(['036', '041']);

// Forward migrations that predate the mandatory-rollback rule. Their filenames
// are immutable identities, so a `.undo.sql` cannot be retro-fitted for them.
const UNDO_EXEMPT = new Set(['020_contract_invocations_index.sql', '036_security_auth.sql']);

const FORWARD_RE = /^(\d+)_(.+)\.sql$/;

function isForwardMigration(file) {
  if (!FORWARD_RE.test(file)) return false;
  if (file.endsWith('.undo.sql')) return false;
  return !file.endsWith('.postgres.sql') && !file.endsWith('.sqlite.sql');
}

function checkMigrations(dir = MIGRATIONS_DIR) {
  const errors = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const present = new Set(files);
  const forward = files.filter(isForwardMigration);

  const byPrefix = new Map();
  for (const file of forward) {
    const prefix = file.match(FORWARD_RE)[1];
    const group = byPrefix.get(prefix) || [];
    group.push(file);
    byPrefix.set(prefix, group);
  }

  for (const [prefix, group] of byPrefix) {
    if (
      group.length > 1 &&
      Number(prefix) >= NEXT_FREE_PREFIX &&
      !ALLOWED_DUPLICATE_PREFIXES.has(prefix)
    ) {
      errors.push(`duplicate migration prefix ${prefix}: ${group.sort().join(', ')}`);
    }
  }

  for (const file of forward) {
    if (UNDO_EXEMPT.has(file)) continue;
    const undo = `${file.slice(0, -4)}.undo.sql`;
    if (!present.has(undo)) {
      errors.push(`forward migration ${file} is missing ${undo}`);
    }
  }

  for (const file of files) {
    if (!file.endsWith('.postgres.sql')) continue;
    const base = `${file.slice(0, -'.postgres.sql'.length)}.sql`;
    if (!present.has(base)) {
      errors.push(`dialect file ${file} has no base migration ${base}`);
    }
  }

  return errors;
}

function main() {
  const errors = checkMigrations();
  if (errors.length > 0) {
    console.error('[check-migrations] FAILED');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('[check-migrations] OK');
}

if (require.main === module) {
  main();
}

module.exports = { checkMigrations, isForwardMigration };
