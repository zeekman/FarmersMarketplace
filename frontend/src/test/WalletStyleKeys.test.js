// #417 – Wallet.jsx must not have duplicate keys in the s style object
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
  resolve(__dirname, '../pages/Wallet.jsx'),
  'utf8'
);

test('s style object has no duplicate keys', () => {
  // Extract the const s = { ... } block
  const match = src.match(/const s\s*=\s*\{([\s\S]*?)\n\};/);
  expect(match).not.toBeNull();

  const body = match[1];
  // Collect every property key (bare identifier or quoted string)
  const keys = [...body.matchAll(/^\s{2}([\w]+)\s*:/gm)].map(m => m[1]);

  const seen = new Set();
  const duplicates = [];
  for (const key of keys) {
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }

  expect(duplicates).toEqual([]);
});
