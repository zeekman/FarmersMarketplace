#!/usr/bin/env node
/**
 * check-bundle-size.js  (#1056)
 *
 * Reads the Vite production build output from dist/assets/, measures the
 * total size of all JS chunks and the combined initial-load chunk size
 * (vendor + index), then fails with a non-zero exit code when either budget
 * is exceeded.
 *
 * Budgets (uncompressed bytes):
 *   INITIAL_BUDGET_KB  – vendor + index chunks that every page must download
 *   TOTAL_BUDGET_KB    – all JS chunks combined
 *
 * Override budgets for a deliberate one-off increase:
 *   BUNDLE_INITIAL_BUDGET_KB=600 BUNDLE_TOTAL_BUDGET_KB=6000 node scripts/check-bundle-size.js
 */

import { readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');

// Budgets in kibibytes (1 KiB = 1024 bytes).
const INITIAL_BUDGET_KB = Number(process.env.BUNDLE_INITIAL_BUDGET_KB ?? 500);
const TOTAL_BUDGET_KB   = Number(process.env.BUNDLE_TOTAL_BUDGET_KB   ?? 5000);

function kib(bytes) {
  return (bytes / 1024).toFixed(1);
}

let files;
try {
  files = readdirSync(DIST_ASSETS);
} catch {
  console.error(`[bundle-size] dist/assets not found — run "npm run build" first.`);
  process.exit(1);
}

const jsFiles = files
  .filter(f => f.endsWith('.js'))
  .map(f => ({ name: f, size: statSync(join(DIST_ASSETS, f)).size }))
  .sort((a, b) => b.size - a.size);

if (jsFiles.length === 0) {
  console.error('[bundle-size] No JS files found in dist/assets.');
  process.exit(1);
}

// Initial chunks = vendor chunk + index/main chunk (everything a user must
// download before React can render, regardless of which route they visit).
const initialChunks = jsFiles.filter(
  f => f.name.startsWith('vendor') || f.name.startsWith('index') || f.name.startsWith('main')
);
const initialBytes  = initialChunks.reduce((s, f) => s + f.size, 0);
const totalBytes    = jsFiles.reduce((s, f) => s + f.size, 0);

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n── Bundle size report ──────────────────────────────────────');
console.log('Chunk                                        Size');
console.log('─'.repeat(52));
for (const f of jsFiles) {
  const flag = initialChunks.some(c => c.name === f.name) ? ' ◀ initial' : '';
  console.log(`  ${basename(f.name).padEnd(42)} ${kib(f.size).padStart(7)} KiB${flag}`);
}
console.log('─'.repeat(52));
console.log(`  Initial load total${' '.repeat(23)} ${kib(initialBytes).padStart(7)} KiB  (budget: ${INITIAL_BUDGET_KB} KiB)`);
console.log(`  All chunks total  ${' '.repeat(23)} ${kib(totalBytes).padStart(7)} KiB  (budget: ${TOTAL_BUDGET_KB} KiB)`);
console.log();

// ── Write GitHub step summary if running in CI ───────────────────────────────
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  const rows = jsFiles
    .map(f => `| \`${f.name}\` | ${kib(f.size)} KiB | ${initialChunks.some(c => c.name === f.name) ? '✅ initial' : ''} |`)
    .join('\n');
  const md = [
    '## 📦 Frontend Bundle Size Report',
    '',
    `| Chunk | Size | Initial? |`,
    `|-------|------|----------|`,
    rows,
    '',
    `**Initial load**: ${kib(initialBytes)} KiB (budget: ${INITIAL_BUDGET_KB} KiB)`,
    `**Total JS**: ${kib(totalBytes)} KiB (budget: ${TOTAL_BUDGET_KB} KiB)`,
  ].join('\n');
  writeFileSync(summaryFile, md + '\n', { flag: 'a' });
}

// ── Budget enforcement ───────────────────────────────────────────────────────
let failed = false;

if (initialBytes / 1024 > INITIAL_BUDGET_KB) {
  console.error(
    `[bundle-size] ❌ Initial chunk ${kib(initialBytes)} KiB exceeds budget of ${INITIAL_BUDGET_KB} KiB.`
  );
  console.error(`   To raise the budget deliberately, set BUNDLE_INITIAL_BUDGET_KB in the CI workflow.`);
  failed = true;
} else {
  console.log(`[bundle-size] ✅ Initial chunk ${kib(initialBytes)} KiB is within budget (${INITIAL_BUDGET_KB} KiB).`);
}

if (totalBytes / 1024 > TOTAL_BUDGET_KB) {
  console.error(
    `[bundle-size] ❌ Total bundle ${kib(totalBytes)} KiB exceeds budget of ${TOTAL_BUDGET_KB} KiB.`
  );
  console.error(`   To raise the budget deliberately, set BUNDLE_TOTAL_BUDGET_KB in the CI workflow.`);
  failed = true;
} else {
  console.log(`[bundle-size] ✅ Total bundle ${kib(totalBytes)} KiB is within budget (${TOTAL_BUDGET_KB} KiB).`);
}

process.exit(failed ? 1 : 0);
