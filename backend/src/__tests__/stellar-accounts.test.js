/**
 * Unit tests for utils/stellar-accounts.js — wallet creation and funding
 */

process.env.NODE_ENV = 'test';

const bip39 = require('bip39');
const {
  createWallet,
  createWalletFromMnemonic,
  deriveKeypairFromMnemonic,
  fundTestnetAccount,
  getBalance,
  getAllBalances,
  addTrustline,
  removeTrustline,
  mergeAccount,
  lookupFederationAddress,
  resolveFederationAddress,
  FederationError,
} = require('../utils/stellar-accounts');

// Mock stellar-config
jest.mock('../utils/stellar-config', () => {
  const mockKeypair = {
    publicKey: () => 'GPUBKEY123',
    secret: () => 'SSECRET123',
  };
  
  return {
    StellarSdk: {
      Keypair: {
        random: jest.fn(() => mockKeypair),
        fromSecret: jest.fn(() => mockKeypair),
      },
      Asset: jest.fn(),
      TransactionBuilder: jest.fn(),
      Operation: {
        changeTrust: jest.fn(),
        accountMerge: jest.fn(),
      },
      BASE_FEE: '100',
      StrKey: {
        isValidEd25519PublicKey: jest.fn((key) => key.startsWith('G')),
      },
      FederationServer: {
        resolve: jest.fn(),
      },
      Federation: {
        Server: {
          resolve: jest.fn(),
        },
      },
    },
    server: {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
    },
    networkPassphrase: 'Test SDF Network ; September 2015',
    isTestnet: true,
  };
});

describe('stellar-accounts.js — createWallet', () => {
  it('returns a wallet with publicKey and secretKey', () => {
    const wallet = createWallet();
    expect(wallet).toHaveProperty('publicKey');
    expect(wallet).toHaveProperty('secretKey');
    expect(typeof wallet.publicKey).toBe('string');
    expect(typeof wallet.secretKey).toBe('string');
  });

  it('creates different wallets on each call', () => {
    const { StellarSdk } = require('../utils/stellar-config');
    StellarSdk.Keypair.random
      .mockReturnValueOnce({ publicKey: () => 'GPUB1', secret: () => 'SECRET1' })
      .mockReturnValueOnce({ publicKey: () => 'GPUB2', secret: () => 'SECRET2' });

    const wallet1 = createWallet();
    const wallet2 = createWallet();
    
    expect(wallet1.publicKey).not.toBe(wallet2.publicKey);
  });
});

describe('stellar-accounts.js — createWalletFromMnemonic', () => {
  it('returns mnemonic, publicKey, and secretKey', () => {
    const wallet = createWalletFromMnemonic();
    expect(wallet).toHaveProperty('mnemonic');
    expect(wallet).toHaveProperty('publicKey');
    expect(wallet).toHaveProperty('secretKey');
  });

  it('generates a valid 24-word BIP39 mnemonic', () => {
    const wallet = createWalletFromMnemonic();
    const words = wallet.mnemonic.split(' ');
    expect(words.length).toBe(24);
    expect(bip39.validateMnemonic(wallet.mnemonic)).toBe(true);
  });

  it('generates different mnemonics on each call', () => {
    const wallet1 = createWalletFromMnemonic();
    const wallet2 = createWalletFromMnemonic();
    expect(wallet1.mnemonic).not.toBe(wallet2.mnemonic);
  });
});

describe('stellar-accounts.js — deriveKeypairFromMnemonic', () => {
  it('derives a keypair from a valid mnemonic', () => {
    const mnemonic = bip39.generateMnemonic(256);
    const result = deriveKeypairFromMnemonic(mnemonic);
    
    expect(result).toHaveProperty('publicKey');
    expect(result).toHaveProperty('secretKey');
  });

  it('throws error for invalid mnemonic', () => {
    expect(() => {
      deriveKeypairFromMnemonic('invalid mnemonic phrase');
    }).toThrow('Invalid mnemonic phrase');
  });

  it('derives the same keypair for the same mnemonic (deterministic)', () => {
    const mnemonic = bip39.generateMnemonic(256);
    const result1 = deriveKeypairFromMnemonic(mnemonic);
    const result2 = deriveKeypairFromMnemonic(mnemonic);
    
    expect(result1.publicKey).toBe(result2.publicKey);
    expect(result1.secretKey).toBe(result2.secretKey);
  });
});

describe('stellar-accounts.js — fundTestnetAccount', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('calls Friendbot with the public key', async () => {
    global.fetch.mockResolvedValueOnce({
      json: async () => ({ status: 'success' }),
    });

    const result = await fundTestnetAccount('GPUBKEY123');
    
    expect(global.fetch).toHaveBeenCalledWith(
      'https://friendbot.stellar.org?addr=GPUBKEY123'
    );
    expect(result).toEqual({ status: 'success' });
  });

  it('returns error when Friendbot fails', async () => {
    global.fetch.mockResolvedValueOnce({
      json: async () => ({ error: 'Account already exists' }),
    });

    const result = await fundTestnetAccount('GPUBKEY123');
    expect(result).toHaveProperty('error');
  });

  it('throws on network failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(fundTestnetAccount('GPUBKEY123')).rejects.toThrow('Network error');
  });
});

describe('stellar-accounts.js — getBalance', () => {
  const { server } = require('../utils/stellar-config');

  it('returns XLM balance when account exists', async () => {
    server.loadAccount.mockResolvedValueOnce({
      balances: [
        { asset_type: 'native', balance: '100.5' },
      ],
    });

    const balance = await getBalance('GPUBKEY123');
    expect(balance).toBe(100.5);
  });

  it('returns 0 when account does not exist', async () => {
    server.loadAccount.mockRejectedValueOnce(new Error('Account not found'));

    const balance = await getBalance('GPUBKEY123');
    expect(balance).toBe(0);
  });

  it('returns 0 when account has no native balance', async () => {
    server.loadAccount.mockResolvedValueOnce({
      balances: [],
    });

    const balance = await getBalance('GPUBKEY123');
    expect(balance).toBe(0);
  });
});

describe('stellar-accounts.js — getAllBalances', () => {
  const { server } = require('../utils/stellar-config');

  it('returns all asset balances for an account', async () => {
    server.loadAccount.mockResolvedValueOnce({
      balances: [
        { asset_type: 'native', balance: '100.5' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER', balance: '50.25', limit: '1000' },
      ],
    });

    const balances = await getAllBalances('GPUBKEY123');
    
    expect(balances).toHaveLength(2);
    expect(balances[0]).toEqual({
      asset_type: 'native',
      asset_code: 'XLM',
      asset_issuer: null,
      balance: 100.5,
      limit: null,
    });
    expect(balances[1]).toEqual({
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GISSUER',
      balance: 50.25,
      limit: 1000,
    });
  });

  it('returns empty array when account does not exist', async () => {
    server.loadAccount.mockRejectedValueOnce(new Error('Not found'));

    const balances = await getAllBalances('GPUBKEY123');
    expect(balances).toEqual([]);
  });
});

describe('stellar-accounts.js — addTrustline', () => {
  const { server, StellarSdk } = require('../utils/stellar-config');

  beforeEach(() => {
    const mockTx = {
      sign: jest.fn(),
      build: jest.fn().mockReturnThis(),
    };
    
    StellarSdk.TransactionBuilder = jest.fn(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => mockTx),
    }));
    
    server.loadAccount.mockResolvedValue({ id: 'GPUBKEY123' });
    server.submitTransaction.mockResolvedValue({ hash: 'TXHASH123' });
  });

  it('adds a trustline and returns transaction hash', async () => {
    const result = await addTrustline({
      secret: 'SSECRET123',
      assetCode: 'USDC',
      assetIssuer: 'GISSUER123',
    });

    expect(result).toBe('TXHASH123');
    expect(StellarSdk.Asset).toHaveBeenCalledWith('USDC', 'GISSUER123');
  });
});

describe('stellar-accounts.js — removeTrustline', () => {
  const { server, StellarSdk } = require('../utils/stellar-config');

  beforeEach(() => {
    const mockTx = {
      sign: jest.fn(),
      build: jest.fn().mockReturnThis(),
    };
    
    StellarSdk.TransactionBuilder = jest.fn(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => mockTx),
    }));
    
    server.submitTransaction.mockResolvedValue({ hash: 'TXHASH123' });
  });

  it('throws error when trying to remove trustline with non-zero balance', async () => {
    server.loadAccount.mockResolvedValueOnce({
      balances: [
        { asset_code: 'USDC', asset_issuer: 'GISSUER123', balance: '10.5' },
      ],
    });

    await expect(
      removeTrustline({
        secret: 'SSECRET123',
        assetCode: 'USDC',
        assetIssuer: 'GISSUER123',
      })
    ).rejects.toThrow('Cannot remove trustline with non-zero balance');
  });

  it('removes trustline when balance is zero', async () => {
    server.loadAccount.mockResolvedValueOnce({
      balances: [
        { asset_code: 'USDC', asset_issuer: 'GISSUER123', balance: '0' },
      ],
    });

    const result = await removeTrustline({
      secret: 'SSECRET123',
      assetCode: 'USDC',
      assetIssuer: 'GISSUER123',
    });

    expect(result).toBe('TXHASH123');
  });
});

describe('stellar-accounts.js — mergeAccount', () => {
  const { server, StellarSdk } = require('../utils/stellar-config');

  beforeEach(() => {
    const mockTx = {
      sign: jest.fn(),
      build: jest.fn().mockReturnThis(),
    };
    
    StellarSdk.TransactionBuilder = jest.fn(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => mockTx),
    }));
    
    server.submitTransaction.mockResolvedValue({ hash: 'MERGE_TX_HASH' });
  });

  it('merges account when destination exists', async () => {
    server.loadAccount
      .mockResolvedValueOnce({ id: 'GDESTINATION' }) // destination check
      .mockResolvedValueOnce({ id: 'GSOURCE' });     // source account

    const result = await mergeAccount({
      sourceSecret: 'SSOURCE',
      destinationPublicKey: 'GDESTINATION',
    });

    expect(result).toBe('MERGE_TX_HASH');
  });

  it('throws error when destination account does not exist', async () => {
    const notFoundError = new Error('Not found');
    notFoundError.response = { status: 404 };
    server.loadAccount.mockRejectedValueOnce(notFoundError);

    await expect(
      mergeAccount({
        sourceSecret: 'SSOURCE',
        destinationPublicKey: 'GDESTINATION',
      })
    ).rejects.toThrow('Destination account does not exist');
  });
});

describe('stellar-accounts.js — lookupFederationAddress', () => {
  const { StellarSdk } = require('../utils/stellar-config');

  it('returns federation address when found', async () => {
    StellarSdk.FederationServer.resolve.mockResolvedValueOnce({
      stellar_address: 'alice*farmersmarket.io',
    });

    const result = await lookupFederationAddress('GPUBKEY123');
    expect(result).toBe('alice*farmersmarket.io');
  });

  it('returns null when federation address not found', async () => {
    StellarSdk.FederationServer.resolve.mockRejectedValueOnce(new Error('Not found'));

    const result = await lookupFederationAddress('GPUBKEY123');
    expect(result).toBeNull();
  });

  it('returns null when input is null', async () => {
    const result = await lookupFederationAddress(null);
    expect(result).toBeNull();
  });

  it('caches results for 10 minutes', async () => {
    StellarSdk.FederationServer.resolve.mockResolvedValueOnce({
      stellar_address: 'alice*farmersmarket.io',
    });

    await lookupFederationAddress('GPUBKEY123');
    const cachedResult = await lookupFederationAddress('GPUBKEY123');

    expect(cachedResult).toBe('alice*farmersmarket.io');
    expect(StellarSdk.FederationServer.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('stellar-accounts.js — resolveFederationAddress', () => {
  const { StellarSdk } = require('../utils/stellar-config');
  
  const mockDb = {
    prepare: jest.fn(() => ({
      get: jest.fn(),
    })),
  };

  it('returns public key as-is when address has no asterisk', async () => {
    const result = await resolveFederationAddress('GPUBKEY123', mockDb);
    expect(result).toEqual({ publicKey: 'GPUBKEY123', memo: null });
  });

  it('resolves local federation address from database', async () => {
    const getStub = jest.fn().mockReturnValue({ stellar_public_key: 'GPUBKEY123' });
    mockDb.prepare.mockReturnValue({ get: getStub });

    const result = await resolveFederationAddress('alice*localhost', mockDb);
    
    expect(result.publicKey).toBe('GPUBKEY123');
    expect(result.memo).toBeNull();
  });

  it('throws FederationError when local address not found', async () => {
    const getStub = jest.fn().mockReturnValue(null);
    mockDb.prepare.mockReturnValue({ get: getStub });

    await expect(
      resolveFederationAddress('unknown*localhost', mockDb)
    ).rejects.toThrow(FederationError);
  });

  it('resolves remote federation address via Federation protocol', async () => {
    StellarSdk.Federation.Server.resolve.mockResolvedValueOnce({
      account_id: 'GREMOTE123',
      memo: 'test-memo',
    });

    const result = await resolveFederationAddress('bob*remote.io', mockDb);
    
    expect(result.publicKey).toBe('GREMOTE123');
    expect(result.memo).toBe('test-memo');
  });

  it('throws FederationError when remote server is unreachable', async () => {
    StellarSdk.Federation.Server.resolve.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      resolveFederationAddress('bob*unreachable.io', mockDb)
    ).rejects.toThrow(FederationError);
  });

  it('throws FederationError when resolved address is invalid', async () => {
    StellarSdk.Federation.Server.resolve.mockResolvedValueOnce({
      account_id: 'INVALID_KEY',
    });
    StellarSdk.StrKey.isValidEd25519PublicKey.mockReturnValueOnce(false);

    await expect(
      resolveFederationAddress('alice*remote.io', mockDb)
    ).rejects.toThrow(FederationError);
  });

  it('caches resolved addresses for 5 minutes', async () => {
    StellarSdk.Federation.Server.resolve.mockResolvedValueOnce({
      account_id: 'GREMOTE123',
    });

    await resolveFederationAddress('bob*remote.io', mockDb);
    const cachedResult = await resolveFederationAddress('bob*remote.io', mockDb);

    expect(cachedResult.publicKey).toBe('GREMOTE123');
    expect(StellarSdk.Federation.Server.resolve).toHaveBeenCalledTimes(1);
  });
});
