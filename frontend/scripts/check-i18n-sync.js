#!/usr/bin/env node
/**
 * CI script: fails if sw.json is missing any keys present in en.json.
 * Usage: node scripts/check-i18n-sync.js
 */
const en = require('../src/i18n/en.json');
const sw = require('../src/i18n/sw.json');

function getKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? getKeys(v, prefix ? `${prefix}.${k}` : k)
      : [prefix ? `${prefix}.${k}` : k]
  );
}

const missing = getKeys(en).filter(k => !new Set(getKeys(sw)).has(k));

if (missing.length > 0) {
  console.error('❌ sw.json is missing the following keys from en.json:');
  missing.forEach(k => console.error(`  - ${k}`));
  process.exit(1);
}

console.log('✅ sw.json is in sync with en.json');
