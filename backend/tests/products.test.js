const jwt = require("jsonwebtoken");
const { request, app, mockGet, mockAll, mockRun, getCsrf } = require("./setup");

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || "test-secret-for-jest";
const farmerToken = jwt.sign({ id: 1, role: "farmer" }, SECRET);
const buyerToken = jwt.sign({ id: 2, role: "buyer" }, SECRET);

describe("GET /api/products", () => {
  it("returns paginated product list with pagination metadata", async () => {
    mockGet.mockReturnValueOnce({ count: 0 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalPages).toBe(0);
  });

  it("respects page and limit query params", async () => {
    mockGet.mockReturnValueOnce({ count: 30 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get("/api/products?page=2&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
    expect(res.body.totalPages).toBe(3);
  });

  it("clamps limit to 100", async () => {
    mockGet.mockReturnValueOnce({ count: 0 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get("/api/products?limit=500");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it("defaults to page 1 when page param is omitted", async () => {
    mockGet.mockReturnValueOnce({ count: 0 });
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});

describe("POST /api/products", () => {
  it("farmer can create a product", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockRun.mockReturnValueOnce({ lastInsertRowid: 5 });
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ name: "Tomatoes", price: 2.5, quantity: 100, unit: "kg" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
  });

  it("buyer cannot create a product", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ name: "Tomatoes", price: 2.5, quantity: 100 });
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/products")
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ name: "X", price: 1, quantity: 1 });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing name", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ price: 1, quantity: 1 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/products/:id", () => {
  it("returns 404 for unknown product", async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app).get("/api/products/9999");
    expect(res.status).toBe(404);
  });

  it("returns product details", async () => {
    mockGet.mockReturnValueOnce({
      id: 1,
      name: "Carrots",
      price: 1.0,
      farmer_name: "Alice",
    });
    const res = await request(app).get("/api/products/1");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Carrots");
  });
});

describe("GET /api/products/mine/list", () => {
  it("returns farmer's own products", async () => {
    mockAll.mockReturnValueOnce([{ id: 1, name: "Beans" }]);
    const res = await request(app)
      .get("/api/products/mine/list")
      .set("Authorization", `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("returns 403 for buyers", async () => {
    const res = await request(app)
      .get("/api/products/mine/list")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/products/:id", () => {
  it("farmer can delete their own product", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce({ id: 1, farmer_id: 1 });
    const res = await request(app)
      .delete("/api/products/1")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(200);
  });

  it("returns 404 for another farmer's product", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .delete("/api/products/1")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(404);
  });
});
