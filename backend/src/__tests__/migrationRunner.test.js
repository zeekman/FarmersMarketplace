const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations, getPendingFiles, getMigrationFile } = require('../db/migrationRunner');

describe('migration runner failure recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  const sqlite = new Database(':memory:');
  const db = {
    isPostgres: false,
    placeholder: () => '?',
    exec: async (sql) => sqlite.exec(sql),
    query: async (sql, params = []) => {
      if (/^SELECT/i.test(sql)) return { rows: sqlite.prepare(sql).all(...params) };
      sqlite.prepare(sql).run(...params);
      return { rows: [] };
    },
  };

  afterAll(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('leaves the failed file pending and resumes after it is fixed', async () => {
    fs.writeFileSync(path.join(dir, '001_first.sql'), 'CREATE TABLE first (id INTEGER);');
    fs.writeFileSync(path.join(dir, '002_broken.sql'), 'BROKEN SQL;');
    fs.writeFileSync(path.join(dir, '003_last.sql'), 'CREATE TABLE last (id INTEGER);');

    await expect(runMigrations(db, dir)).rejects.toThrow('Failed migration 002_broken.sql');
    const afterFailure = await db.query('SELECT name FROM migrations ORDER BY name');
    expect(afterFailure.rows).toEqual([{ name: '001_first.sql' }]);

    fs.writeFileSync(path.join(dir, '002_broken.sql'), 'CREATE TABLE second (id INTEGER);');
    await runMigrations(db, dir);
    const applied = await db.query('SELECT name FROM migrations ORDER BY name');
    expect(applied.rows.map(({ name }) => name)).toEqual([
      '001_first.sql', '002_broken.sql', '003_last.sql',
    ]);
  });

  it('uses a SQLite-specific migration when one is present', async () => {
    fs.writeFileSync(path.join(dir, '004_dialect.sql'), 'CREATE TABLE wrong_dialect (id INTEGER);');
    fs.writeFileSync(path.join(dir, '004_dialect.sqlite'), 'CREATE TABLE sqlite_dialect (id INTEGER);');

    await runMigrations(db, dir);

    expect(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_dialect'"
    ).get()).toEqual({ name: 'sqlite_dialect' });
    expect(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wrong_dialect'"
    ).get()).toBeUndefined();
  });

  it('selects a `.postgres.sql` override without treating it as a separate migration', () => {
    fs.writeFileSync(path.join(dir, '005_postgres_variant.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(dir, '005_postgres_variant.postgres.sql'), 'SELECT 2;');

    expect(getMigrationFile('005_postgres_variant.sql', 'postgres', dir)).toBe(
      path.join(dir, '005_postgres_variant.postgres.sql')
    );
    expect(getPendingFiles(new Set(), dir)).toContain('005_postgres_variant.sql');
    expect(getPendingFiles(new Set(), dir)).not.toContain('005_postgres_variant.postgres.sql');
  });

  it('orders migrations with a shared numeric prefix by full filename', () => {
    const duplicatePrefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duplicate-prefix-migrations-'));
    try {
      fs.writeFileSync(path.join(duplicatePrefixDir, '002_zeta.sql'), '');
      fs.writeFileSync(path.join(duplicatePrefixDir, '002_alpha.sql'), '');

      expect(getPendingFiles(new Set(), duplicatePrefixDir)).toEqual([
        '002_alpha.sql',
        '002_zeta.sql',
      ]);
    } finally {
      fs.rmSync(duplicatePrefixDir, { recursive: true });
    }
  });
});
