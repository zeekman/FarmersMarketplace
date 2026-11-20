#!/usr/bin/env node
/**
 * Remove UTF-8 BOM from i18n JSON files and report key differences.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.resolve(__dirname, '../src/i18n');

const files = ['en.json', 'sw.json', 'ar.json'];

console.log('Checking i18n files for BOM and key consistency...\n');

const locales = {};

for (const file of files) {
  const filePath = path.join(i18nDir, file);
  const raw = fs.readFileSync(filePath);
  
  // Check for UTF-8 BOM (EF BB BF)
  const hasBOM = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
  
  if (hasBOM) {
    console.log(`✗ ${file} has UTF-8 BOM - removing...`);
    // Remove BOM and write back
    const content = raw.toString('utf8').replace(/^\uFEFF/, '');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ BOM removed from ${file}`);
  } else {
    console.log(`✓ ${file} has no BOM`);
  }
  
  // Parse JSON to check keys
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const locale = file.replace('.json', '');
  locales[locale] = JSON.parse(content);
}

console.log('\nKey count comparison:');
for (const [locale, data] of Object.entries(locales)) {
  const keys = Object.keys(data);
  console.log(`  ${locale}.json: ${keys.length} keys`);
}

// Find orphaned keys in ar.json
const enKeys = new Set(Object.keys(locales.en));
const arKeys = new Set(Object.keys(locales.ar));
const orphanedKeys = [...arKeys].filter(k => !enKeys.has(k));

if (orphanedKeys.length > 0) {
  console.log(`\n⚠ Found ${orphanedKeys.length} orphaned keys in ar.json (not in en.json):`);
  orphanedKeys.forEach(k => console.log(`  - ${k}`));
  console.log('\nThese keys should be removed from ar.json or added to en.json if still used.');
} else {
  console.log('\n✓ No orphaned keys found in ar.json');
}

// Find missing keys in ar.json
const missingKeys = [...enKeys].filter(k => !arKeys.has(k));
if (missingKeys.length > 0) {
  console.log(`\n⚠ Found ${missingKeys.length} keys in en.json missing from ar.json:`);
  missingKeys.slice(0, 10).forEach(k => console.log(`  - ${k}`));
  if (missingKeys.length > 10) {
    console.log(`  ... and ${missingKeys.length - 10} more`);
  }
}

console.log('\n✓ BOM fix complete');
