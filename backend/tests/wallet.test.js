const jwt = require("jsonwebtoken");
const { request, app, mockGet, mockRun, getCsrf } = require("./setup");
const stellar = jest.requireMock("../src/utils/stellar");

beforeEach(() => {
  jest.clearAllMocks();
  stellar.isTestnet = true; // default to testnet for each test
});

const SECRET = process.env.JWT_SECRET || "test-secret-for-jest";
const token = jwt.sign({ id: 1, role: "buyer" }, SECRET);

describe("GET /api/wallet", () => {
  it("returns balance for authenticated user", async () => {
    mockGet.mockReturnValueOnce({ stellar_public_key: "GPUB" });
    stellar.getBalance.mockResolvedValueOnce(500);
    const res = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(500);
    expect(res.body.publicKey).toBe("GPUB");
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/wallet");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/wallet/transactions", () => {
  it("returns transaction list", async () => {
    mockGet.mockReturnValueOnce({ stellar_public_key: "GPUB" });
    stellar.getTransactions.mockResolvedValueOnce([
      { id: "tx1", amount: "10" },
    ]);
    const res = await request(app)
      .get("/api/wallet/transactions")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("POST /api/wallet/fund", () => {
  it("funds the account on testnet", async () => {
    stellar.isTestnet = true;
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({ stellar_public_key: "GPUB" });
    stellar.getBalance.mockResolvedValueOnce(10000);
    const res = await request(app)
      .post("/api/wallet/fund")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(10000);
  });

  it("returns 400 on mainnet", async () => {
    stellar.isTestnet = false;
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/wallet/fund")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(400);
  });
});

// Valid external Stellar public key (not the user's own)
const EXTERNAL_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
// USER_KEY must be a valid 56-char Stellar key (G + 55 base32 chars) to pass validation
const USER_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("POST /api/wallet/send", () => {
  const validBody = { destination: EXTERNAL_KEY, amount: 10 };

  it("sends XLM successfully", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({
      stellar_public_key: USER_KEY,
      stellar_secret_key: "SSECRET",
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockResolvedValueOnce("TXHASH_SEND");

    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe("TXHASH_SEND");
    expect(res.body.amount).toBe(10);
    expect(res.body.destination).toBe(EXTERNAL_KEY);
  });

  it("sends XLM with optional memo", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({
      stellar_public_key: USER_KEY,
      stellar_secret_key: "SSECRET",
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockResolvedValueOnce("TXHASH_MEMO");

    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ ...validBody, memo: "invoice #42" });

    expect(res.status).toBe(200);
    expect(res.body.memo).toBe("invoice #42");
    expect(stellar.sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({ memo: "invoice #42" }),
    );
  });

  it("returns 402 when balance is insufficient", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({
      stellar_public_key: USER_KEY,
      stellar_secret_key: "SSECRET",
    });
    stellar.getBalance.mockResolvedValueOnce(5); // less than 10

    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send(validBody);

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  it("returns 400 when sending to own wallet", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({
      stellar_public_key: USER_KEY,
      stellar_secret_key: "SSECRET",
    });
    stellar.getBalance.mockResolvedValueOnce(500);

    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ destination: USER_KEY, amount: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own wallet/i);
  });

  it("returns 400 for invalid destination key", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ destination: "not-a-stellar-key", amount: 10 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing amount", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ destination: EXTERNAL_KEY });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative amount", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ destination: EXTERNAL_KEY, amount: -5 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when memo exceeds 28 characters", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ destination: EXTERNAL_KEY, amount: 10, memo: "a".repeat(29) });
    expect(res.status).toBe(400);
  });

  it("returns 502 when Stellar transaction fails", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({
      stellar_public_key: USER_KEY,
      stellar_secret_key: "SSECRET",
    });
    stellar.getBalance.mockResolvedValueOnce(500);
    stellar.sendPayment.mockRejectedValueOnce(new Error("op_no_destination"));

    const res = await request(app)
      .post("/api/wallet/send")
      .set("Authorization", `Bearer ${token}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/stellar transaction failed/i);
  });

  it("returns 401 without token", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/wallet/send")
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send(validBody);
    expect(res.status).toBe(401);
  });
});
