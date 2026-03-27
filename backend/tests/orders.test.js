const jwt = require("jsonwebtoken");
const {
  request,
  app,
  mockGet,
  mockAll,
  mockRun,
  mockTransaction,
  getCsrf,
} = require("./setup");
const stellar = jest.requireMock("../src/utils/stellar");

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || "test-secret-for-jest";
const farmerToken = jwt.sign({ id: 1, role: "farmer" }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: "buyer" }, SECRET);

const product = {
  id: 10,
  name: "Apples",
  price: 5.0,
  quantity: 10,
  farmer_id: 1,
  farmer_wallet: "GFARMER",
};
const buyer = {
  id: 2,
  stellar_secret_key: "SSECRET",
  stellar_public_key: "GBUYER",
};

describe("POST /api/orders", () => {
  it("buyer places an order successfully", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet
      .mockReturnValueOnce(product) // product lookup
      .mockReturnValueOnce(buyer); // buyer lookup
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 })
      .mockReturnValueOnce({});
    mockGet.mockReturnValueOnce({ id: 1 }); // farmer lookup for email
    mockGet.mockReturnValueOnce({
      quantity: 8,
      low_stock_threshold: 5,
      low_stock_alerted: 0,
    }); // low-stock check
    stellar.getBalance.mockResolvedValueOnce(9999); // sufficient balance
    stellar.sendPayment.mockResolvedValueOnce("TXHASH_OK");

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 10, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.txHash).toBe("TXHASH_OK");
  });

  it("returns 403 when a farmer tries to order", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent product", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 9999, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it("returns 402 when buyer has insufficient balance", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(product).mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(0);
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
  });

  it("returns 400 when stock is insufficient", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(product).mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockRun.mockReturnValueOnce({ changes: 0 });
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 10, quantity: 999 });
    expect(res.status).toBe(400);
  });

  it("marks order failed when payment throws", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(product).mockReturnValueOnce(buyer);
    stellar.getBalance.mockResolvedValueOnce(99999);
    mockRun
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ lastInsertRowid: 99 });
    stellar.sendPayment.mockRejectedValueOnce(new Error("network error"));
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ product_id: 10, quantity: 1 });
    expect(res.status).toBe(402);
    expect(res.body.orderId).toBeDefined();
  });
});

describe("GET /api/orders", () => {
  it("returns paginated buyer order history", async () => {
    mockGet.mockReturnValueOnce({ count: 1 });
    mockAll.mockReturnValueOnce([{ id: 1, product_name: "Apples" }]);
    const res = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalPages).toBe(1);
  });

  it("respects page and limit query params", async () => {
    mockGet.mockReturnValueOnce({ count: 50 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app)
      .get("/api/orders?page=2&limit=10")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
    expect(res.body.totalPages).toBe(5);
  });

  it("clamps limit to 100", async () => {
    mockGet.mockReturnValueOnce({ count: 0 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app)
      .get("/api/orders?limit=999")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it("defaults to page 1 when page param is omitted", async () => {
    mockGet.mockReturnValueOnce({ count: 0 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});

describe("GET /api/orders/sales", () => {
  it("returns paginated farmer sales", async () => {
    mockGet.mockReturnValueOnce({ count: 1 });
    mockAll.mockReturnValueOnce([{ id: 1, product_name: "Apples" }]);
    const res = await request(app)
      .get("/api/orders/sales")
      .set("Authorization", `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
  });

  it("returns 403 for buyers", async () => {
    const res = await request(app)
      .get("/api/orders/sales")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});
