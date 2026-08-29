/**
 * Unit tests for stellar-config utility (issue #1157)
 * Tests Stellar network configuration and validation
 */

describe('stellar-config', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear the require cache for stellar-config
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  test('defaults to testnet', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    const config = require('../utils/stellar-config');

    expect(config.isTestnet).toBe(true);
    expect(config.networkPassphrase).toBe(config.StellarSdk.Networks.TESTNET);
  });

  test('selects mainnet when configured', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.STELLAR_MAINNET_CONFIRMED = 'true';

    const config = require('../utils/stellar-config');

    expect(config.isTestnet).toBe(false);
    expect(config.networkPassphrase).toBe(config.StellarSdk.Networks.PUBLIC);
  });

  test('uses testnet Horizon URL by default', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    delete process.env.STELLAR_HORIZON_URL;

    const config = require('../utils/stellar-config');

    expect(config.server.serverURL.href).toContain('horizon-testnet.stellar.org');
  });

  test('uses mainnet Horizon URL for mainnet', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.STELLAR_MAINNET_CONFIRMED = 'true';
    delete process.env.STELLAR_HORIZON_URL;

    const config = require('../utils/stellar-config');

    expect(config.server.serverURL.href).toContain('horizon.stellar.org');
  });

  test('uses custom Horizon URL when provided', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_HORIZON_URL = 'https://custom-horizon.example.com';

    const config = require('../utils/stellar-config');

    expect(config.server.serverURL.href).toContain('custom-horizon.example.com');
  });

  test('uses testnet Soroban RPC by default', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    delete process.env.SOROBAN_RPC_URL;

    const config = require('../utils/stellar-config');

    expect(config.sorobanServer.serverURL.href).toContain('soroban-testnet.stellar.org');
  });

  test('validates required Soroban environment variables', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.SOROBAN_RPC_URL = 'https://soroban-test.example.com';
    process.env.SOROBAN_ESCROW_CONTRACT_ID = 'CTEST123';
    process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID = 'CXLM456';

    const config = require('../utils/stellar-config');
    const validation = config.validateStellarConfig();

    expect(validation.network).toBe('testnet');
    expect(validation.networkPassphrase).toBe(config.StellarSdk.Networks.TESTNET);
  });

  test('throws error when required variables missing', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    delete process.env.SOROBAN_ESCROW_CONTRACT_ID;
    delete process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID;

    const config = require('../utils/stellar-config');

    expect(() => config.validateStellarConfig()).toThrow(/Missing required Stellar/);
  });

  test('throws error for invalid network', () => {
    process.env.STELLAR_NETWORK = 'invalid';

    expect(() => require('../utils/stellar-config')).toThrow(/Invalid STELLAR_NETWORK/);
  });

  test('requires confirmation for mainnet usage', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    delete process.env.STELLAR_MAINNET_CONFIRMED;

    expect(() => require('../utils/stellar-config')).toThrow(/STELLAR_MAINNET_CONFIRMED=true/);
  });

  test('warns about missing optional variables', () => {
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.SOROBAN_RPC_URL = 'https://soroban-test.example.com';
    process.env.SOROBAN_ESCROW_CONTRACT_ID = 'CTEST123';
    process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID = 'CXLM456';
    delete process.env.REWARD_TOKEN_CONTRACT_ID;
    delete process.env.REWARD_TOKEN_ADMIN_SECRET;

    const config = require('../utils/stellar-config');
    const logger = require('../logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation();

    config.validateStellarConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('REWARD_TOKEN_CONTRACT_ID')
    );

    warnSpy.mockRestore();
  });
});
