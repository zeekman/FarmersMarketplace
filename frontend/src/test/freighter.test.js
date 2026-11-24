import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighterApi from '@stellar/freighter-api';
import {
  isFreighterInstalled,
  connectFreighter,
  disconnectFreighter,
  signWithFreighter,
  toFreighterNetwork,
} from '../utils/freighter';

const PK = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

describe('freighter utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('reports not installed when the extension is missing, errors or throws', async () => {
    freighterApi.isConnected.mockResolvedValue({ isConnected: false });
    expect(await isFreighterInstalled()).toBe(false);
    freighterApi.isConnected.mockResolvedValue({ isConnected: false, error: 'not installed' });
    expect(await isFreighterInstalled()).toBe(false);
    freighterApi.isConnected.mockRejectedValue(new Error('no extension'));
    expect(await isFreighterInstalled()).toBe(false);
  });

  it('reads isConnected from the response object', async () => {
    freighterApi.isConnected.mockResolvedValue({ isConnected: true });
    expect(await isFreighterInstalled()).toBe(true);
  });

  it('connects and remembers the public key and network', async () => {
    freighterApi.isConnected.mockResolvedValue({ isConnected: true });
    freighterApi.requestAccess.mockResolvedValue({ address: PK });
    freighterApi.getNetworkDetails.mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
    const res = await connectFreighter();
    expect(res).toMatchObject({ publicKey: PK, network: 'TESTNET' });
    expect(localStorage.getItem('freighter_public_key')).toBe(PK);
    disconnectFreighter();
    expect(localStorage.getItem('freighter_public_key')).toBeNull();
  });

  it('refuses to connect when Freighter is not installed', async () => {
    freighterApi.isConnected.mockResolvedValue({ isConnected: false });
    await expect(connectFreighter()).rejects.toThrow(/not installed/);
  });

  it('signs with the given network passphrase', async () => {
    freighterApi.signTransaction.mockResolvedValue({ signedTxXdr: 'SIGNED_XDR', signerAddress: PK });
    expect(await signWithFreighter('XDR', 'pass')).toBe('SIGNED_XDR');
    expect(freighterApi.signTransaction).toHaveBeenCalledWith('XDR', { networkPassphrase: 'pass' });
  });

  it('maps app networks to Freighter network names', () => {
    expect(toFreighterNetwork('testnet')).toBe('TESTNET');
    expect(toFreighterNetwork('mainnet')).toBe('PUBLIC');
  });
});
