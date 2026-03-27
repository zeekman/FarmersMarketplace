/**
 * Unit tests for backend/src/utils/stellar.js
 *
 * The global jest.setup.js mocks the entire stellar module for integration tests.
 * Here we unmock it so we can test the real implementation, then mock the SDK itself.
 */

// Undo the global mock set in jest.setup.js
jest.unmock("../src/utils/stellar");

// ── Stellar SDK mock ──────────────────────────────────────────────────────────
const mockSubmitTransaction = jest.fn();
const mockLoadAccount = jest.fn();
const mockPaymentsCall = jest.fn();

const mockPaymentsBuilder = {
  forAccount: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  call: mockPaymentsCall,
};

const mockServerInstance = {
  loadAccount: mockLoadAccount,
  payments: jest.fn(() => mockPaymentsBuilder),
  submitTransaction: mockSubmitTransaction,
};

// TransactionBuilder chain
const mockBuilt = { sign: jest.fn() };
const mockTxBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  addMemo: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn(() => mockBuilt),
};

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => mockServerInstance),
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  Keypair: {
    random: jest.fn(),
    fromSecret: jest.fn(),
  },
  TransactionBuilder: jest.fn(() => mockTxBuilder),
  Operation: {
    payment: jest.fn(() => "mock-payment-op"),
  },
  Asset: {
    native: jest.fn(() => "native-asset"),
  },
  Memo: {
    text: jest.fn((t) => `memo:${t}`),
  },
  BASE_FEE: "100",
}));

// ── Load the real module AFTER mocks are in place ────────────────────────────
let stellar;
beforeAll(() => {
  process.env.STELLAR_NETWORK = "testnet";
  stellar = require("../src/utils/stellar");
});

beforeEach(() => jest.clearAllMocks());

// ── createWallet ─────────────────────────────────────────────────────────────
describe("createWallet()", () => {
  const StellarSdk = require("@stellar/stellar-sdk");

  it("returns an object with publicKey and secretKey", () => {
    StellarSdk.Keypair.random.mockReturnValue({
      publicKey: () => "GPUBLIC_KEY_MOCK",
      secret: () => "SSECRET_KEY_MOCK",
    });

    const wallet = stellar.createWallet();

    expect(wallet).toEqual({
      publicKey: "GPUBLIC_KEY_MOCK",
      secretKey: "SSECRET_KEY_MOCK",
    });
  });

  it("calls Keypair.random() each time", () => {
    StellarSdk.Keypair.random
      .mockReturnValueOnce({ publicKey: () => "GPUB1", secret: () => "SSEC1" })
      .mockReturnValueOnce({ publicKey: () => "GPUB2", secret: () => "SSEC2" });

    const w1 = stellar.createWallet();
    const w2 = stellar.createWallet();

    expect(w1.publicKey).toBe("GPUB1");
    expect(w2.publicKey).toBe("GPUB2");
    expect(StellarSdk.Keypair.random).toHaveBeenCalledTimes(2);
  });
});

// ── getBalance ───────────────────────────────────────────────────────────────
describe("getBalance()", () => {
  it("returns the native XLM balance for a funded account", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "credit_alphanum4", balance: "50.0000000" },
        { asset_type: "native", balance: "123.4567890" },
      ],
    });

    const balance = await stellar.getBalance("GPUB");
    expect(balance).toBe(123.456789);
    expect(mockLoadAccount).toHaveBeenCalledWith("GPUB");
  });

  it("returns 0 when the account has no native balance entry", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "credit_alphanum4", balance: "10.0000000" }],
    });

    const balance = await stellar.getBalance("GPUB");
    expect(balance).toBe(0);
  });

  it("returns 0 for an unfunded (non-existent) account", async () => {
    mockLoadAccount.mockRejectedValue(new Error("Account not found"));

    const balance = await stellar.getBalance("GNEW");
    expect(balance).toBe(0);
  });
});

// ── sendPayment ───────────────────────────────────────────────────────────────
describe("sendPayment()", () => {
  const StellarSdk = require("@stellar/stellar-sdk");

  const params = {
    senderSecret: "SSENDER_SECRET",
    receiverPublicKey: "GRECEIVER",
    amount: 10.5,
    memo: "order-42",
  };

  beforeEach(() => {
    StellarSdk.Keypair.fromSecret.mockReturnValue({
      publicKey: () => "GSENDER",
      // sign is called on the transaction, not the keypair directly
    });
    mockLoadAccount.mockResolvedValue({ id: "GSENDER" });
    mockSubmitTransaction.mockResolvedValue({ hash: "TXHASH_ABC" });
  });

  it("returns the transaction hash on success", async () => {
    const hash = await stellar.sendPayment(params);
    expect(hash).toBe("TXHASH_ABC");
  });

  it("calls submitTransaction with the built & signed transaction", async () => {
    await stellar.sendPayment(params);

    expect(mockBuilt.sign).toHaveBeenCalled();
    expect(mockSubmitTransaction).toHaveBeenCalledWith(mockBuilt);
  });

  it("builds a payment operation with correct destination and amount", async () => {
    await stellar.sendPayment(params);

    expect(StellarSdk.Operation.payment).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "GRECEIVER",
        amount: "10.5000000",
        asset: "native-asset",
      }),
    );
  });

  it("attaches the memo to the transaction", async () => {
    await stellar.sendPayment(params);
    expect(StellarSdk.Memo.text).toHaveBeenCalledWith("order-42");
  });

  it('uses default memo "FarmersMarket" when none provided', async () => {
    await stellar.sendPayment({ ...params, memo: undefined });
    expect(StellarSdk.Memo.text).toHaveBeenCalledWith("FarmersMarket");
  });

  it("loads the sender account before building the transaction", async () => {
    await stellar.sendPayment(params);
    expect(mockLoadAccount).toHaveBeenCalledWith("GSENDER");
  });

  it("propagates errors thrown by submitTransaction", async () => {
    mockSubmitTransaction.mockRejectedValue(new Error("op_no_destination"));
    await expect(stellar.sendPayment(params)).rejects.toThrow(
      "op_no_destination",
    );
  });
});

// ── getTransactions ───────────────────────────────────────────────────────────
describe("getTransactions()", () => {
  const PUBLIC_KEY = "GPUBLIC";

  const makeRecord = (overrides = {}) => ({
    id: "rec1",
    type: "payment",
    asset_type: "native",
    from: "GSENDER",
    to: PUBLIC_KEY,
    amount: "5.0000000",
    created_at: "2024-01-01T00:00:00Z",
    transaction_hash: "TXHASH",
    ...overrides,
  });

  it("returns mapped payment records for the account", async () => {
    mockPaymentsCall.mockResolvedValue({
      records: [makeRecord({ to: PUBLIC_KEY, from: "GSENDER" })],
    });

    const txs = await stellar.getTransactions(PUBLIC_KEY);

    expect(txs).toHaveLength(1);
    expect(txs[0]).toEqual({
      id: "rec1",
      type: "received",
      amount: "5.0000000",
      from: "GSENDER",
      to: PUBLIC_KEY,
      created_at: "2024-01-01T00:00:00Z",
      transaction_hash: "TXHASH",
    });
  });

  it('marks outgoing payments as "sent"', async () => {
    mockPaymentsCall.mockResolvedValue({
      records: [makeRecord({ from: PUBLIC_KEY, to: "GRECEIVER" })],
    });

    const txs = await stellar.getTransactions(PUBLIC_KEY);
    expect(txs[0].type).toBe("sent");
  });

  it("filters out non-payment records", async () => {
    mockPaymentsCall.mockResolvedValue({
      records: [
        makeRecord(),
        makeRecord({ id: "rec2", type: "create_account" }),
        makeRecord({ id: "rec3", type: "path_payment_strict_receive" }),
      ],
    });

    const txs = await stellar.getTransactions(PUBLIC_KEY);
    expect(txs).toHaveLength(1);
    expect(txs[0].id).toBe("rec1");
  });

  it("filters out non-native asset payments", async () => {
    mockPaymentsCall.mockResolvedValue({
      records: [
        makeRecord(),
        makeRecord({ id: "rec2", asset_type: "credit_alphanum4" }),
      ],
    });

    const txs = await stellar.getTransactions(PUBLIC_KEY);
    expect(txs).toHaveLength(1);
  });

  it("returns an empty array when the account has no transactions", async () => {
    mockPaymentsCall.mockResolvedValue({ records: [] });

    const txs = await stellar.getTransactions(PUBLIC_KEY);
    expect(txs).toEqual([]);
  });

  it("returns an empty array when the Horizon call throws", async () => {
    mockPaymentsCall.mockRejectedValue(new Error("Network error"));

    const txs = await stellar.getTransactions(PUBLIC_KEY);
    expect(txs).toEqual([]);
  });

  it("queries payments in descending order with limit 20", async () => {
    mockPaymentsCall.mockResolvedValue({ records: [] });

    await stellar.getTransactions(PUBLIC_KEY);

    expect(mockPaymentsBuilder.forAccount).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(mockPaymentsBuilder.order).toHaveBeenCalledWith("desc");
    expect(mockPaymentsBuilder.limit).toHaveBeenCalledWith(20);
  });
});
