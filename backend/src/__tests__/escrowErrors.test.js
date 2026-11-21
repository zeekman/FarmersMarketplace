'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ESCROW_ERROR_TABLES,
  parseEscrowError,
} = require('../services/escrowErrors');

const registryPath = path.resolve(__dirname, '../../../contracts/escrow/error-codes.txt');
const registeredErrors = fs
  .readFileSync(registryPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*(\d+)\s+([A-Za-z][A-Za-z0-9]*)\s*$/))
  .filter(Boolean)
  .map(([, code, variant]) => ({ code: Number(code), variant }));

describe('escrow error mappings', () => {
  it('maps every error code in contracts/escrow/error-codes.txt', () => {
    expect(registeredErrors.length).toBeGreaterThan(0);

    for (const { code, variant } of registeredErrors) {
      const mapping = ESCROW_ERROR_TABLES.soroban[code];
      const snakeName = variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

      expect(mapping).toBeDefined();
      expect(mapping.code).toBe(`escrow_${snakeName}`);
      expect(Number.isInteger(mapping.httpStatus)).toBe(true);
      expect(mapping.userMessage).toEqual(expect.any(String));
      expect(mapping.userMessage.length).toBeGreaterThan(0);
    }
  });

  it('requires an explicit contract kind and keeps legacy numbering isolated', () => {
    expect(parseEscrowError('Error(Contract, #2)')).toBeNull();
    expect(parseEscrowError('Error(Contract, #2)', 'soroban').code).toBe('escrow_already_settled');
    expect(parseEscrowError('Error(Contract, #2)', 'legacy').code).toBe('escrow_not_found');
    expect(parseEscrowError('Error(Contract, #2)', 'unknown')).toBeNull();
  });
});
