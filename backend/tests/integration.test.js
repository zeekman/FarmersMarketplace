const {
  request,
  app,
  mockRun,
  mockGet,
  mockAll,
  mockPrepare,
  mockTransaction,
  getCsrf,
} = require("./setup");

beforeEach(() => {
  jest.clearAllMocks();
  mockRun.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
  mockGet.mockReturnValue({
    id: 1,
    stellar_public_key: "GPUB",
    stellar_secret_key: "SSECRET",
  });
  mockAll.mockReturnValue([]);
  mockTransaction.mockImplementation((fn) => fn);
});

describe("Full User Flow: register → login → add product → create order → payment", () => {
  it("completes end-to-end flow successfully as farmer + buyer", async () => {
    // 1. Farmer registers (CSRF-exempt)
    const farmerReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Farmer Alice",
        email: "farmer@test.com",
        password: "Secure1pass",
        role: "farmer",
      });
    expect(farmerReg.status).toBe(200);
    const farmerToken = farmerReg.body.token;

    // 2. Farmer adds product
    const { token: csrf1, cookieStr: cookie1 } = await getCsrf();
    const addProduct = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookie1)
      .set("X-CSRF-Token", csrf1)
      .send({ name: "Organic Apples", price: 5.99, quantity: 10, unit: "kg" });
    expect(addProduct.status).toBe(200);

    // 3. Buyer registers (CSRF-exempt)
    const buyerReg = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Buyer Bob",
        email: "buyer@test.com",
        password: "Secure1pass",
        role: "buyer",
      });
    expect(buyerReg.status).toBe(200);
    const buyerToken = buyerReg.body.token;

    // 4. Buyer funds wallet
    const { token: csrf2, cookieStr: cookie2 } = await getCsrf();
    const fundRes = await request(app)
      .post("/api/wallet/fund")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookie2)
      .set("X-CSRF-Token", csrf2);
    expect(fundRes.status).toBe(200);

    // 5. Buyer creates order
    mockGet
      .mockReturnValueOnce({
        id: 1,
        price: 5.99,
        quantity: 10,
        farmer_id: 1,
        name: "Organic Apples",
        unit: "kg",
        farmer_wallet: "GPUB_FARMER",
      })
      .mockReturnValueOnce({
        id: 2,
        name: "Buyer Bob",
        stellar_public_key: "GPUB_BUYER",
        stellar_secret_key: "SSECRET_BUYER",
      });

    const { token: csrf3, cookieStr: cookie3 } = await getCsrf();
    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookie3)
      .set("X-CSRF-Token", csrf3)
      .send({ product_id: 1, quantity: 2 });
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.status).toBe("paid");
    expect(orderRes.body.txHash).toBe("TXHASH123");
  });

  it("fails order on insufficient stock, restores stock, marks failed", async () => {
    mockGet.mockReturnValueOnce({
      id: 1,
      price: 5.99,
      quantity: 1,
      farmer_wallet: "GPUB_FARMER",
    });
    mockTransaction.mockImplementationOnce(() => {
      return () => {
        throw new Error("Insufficient stock");
      };
    });

    const buyerToken = require("jsonwebtoken").sign(
      { id: 2, role: "buyer" },
      process.env.JWT_SECRET || "test-secret-for-jest",
    );
    const { token: csrf, cookieStr } = await getCsrf();
    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 1, quantity: 2 });

    expect(orderRes.status).toBe(400);
  });

  it("fails order on Stellar payment error, restores stock", async () => {
    const stellar = jest.requireMock("../src/utils/stellar");
    mockGet
      .mockReturnValueOnce({
        id: 1,
        price: 5.99,
        quantity: 10,
        farmer_id: 1,
        name: "Apples",
        unit: "kg",
        farmer_wallet: "GPUB_FARMER",
      })
      .mockReturnValueOnce({
        id: 2,
        stellar_public_key: "GPUB_BUYER",
        stellar_secret_key: "SSECRET_BUYER",
      });
    stellar.sendPayment.mockRejectedValueOnce(new Error("Payment failed"));

    const buyerToken = require("jsonwebtoken").sign(
      { id: 2, role: "buyer" },
      process.env.JWT_SECRET || "test-secret-for-jest",
    );
    const { token: csrf, cookieStr } = await getCsrf();
    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 1, quantity: 1 });

    expect(orderRes.status).toBe(402);
  });
});
