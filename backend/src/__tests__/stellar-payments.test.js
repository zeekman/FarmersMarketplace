const mockPaymentOp = jest.fn((value) => value);
const mockSubmitTransaction = jest.fn().mockResolvedValue({ hash: 'tx-hash' });
const mockBuilder = {
  addOperation: jest.fn(() => mockBuilder), addMemo: jest.fn(() => mockBuilder),
  setTimeout: jest.fn(() => mockBuilder), build: jest.fn(() => ({ sign: jest.fn() })),
};
jest.mock('../config', () => ({
  platformFeePercent: 2.5, platformWalletPublicKey: 'GPLATFORM',
  platformFeeAccountSecret: null, feeBumpThresholdXlm: 1,
}));
jest.mock('../utils/stellar-accounts', () => ({ getBalance: jest.fn().mockResolvedValue(10) }));
jest.mock('../utils/stellar-config', () => ({
  StellarSdk: {
    BASE_FEE: '100', Asset: Object.assign(jest.fn(), { native: jest.fn(() => 'XLM') }),
    Keypair: { fromSecret: jest.fn(() => ({ publicKey: () => 'GSENDER' })) },
    Memo: { text: jest.fn((text) => text) }, Operation: { pathPaymentStrictReceive: mockPaymentOp },
    TransactionBuilder: jest.fn(() => mockBuilder),
  },
  server: { loadAccount: jest.fn().mockResolvedValue({}), submitTransaction: mockSubmitTransaction },
  networkPassphrase: 'test', isTestnet: true,
}));

const payments = require('../utils/stellar-payments');

describe('stellar payments', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([[0, 0, 0], [0.0000001, 0, 0.0000001], [10, 0.25, 9.75]])(
    'fee split for %p XLM', (amount, fee, farmer) => {
      expect(payments.getPlatformFeeInfo(amount)).toMatchObject({ feeAmount: fee, farmerAmount: farmer });
    },
  );

  it('formats path-payment send_max to seven decimals', async () => {
    expect(payments.getPathPaymentSendMax(100, 0.5)).toBe(100.5);
    expect(payments.getPathPaymentSendMax(0, 5)).toBe(0);
    await payments.pathPayment({ senderSecret: 'S', sourceAssetCode: 'XLM',
      sendMax: 1.005, receiverPublicKey: 'GDEST', destAmount: 1 });
    expect(mockPaymentOp).toHaveBeenCalledWith(expect.objectContaining({ sendMax: '1.0050000' }));
    expect(mockSubmitTransaction).toHaveBeenCalled();
  });
});
