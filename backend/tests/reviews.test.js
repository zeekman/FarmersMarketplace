const jwt = require("jsonwebtoken");
const { request, app, mockGet, mockAll, mockRun, getCsrf } = require("./setup");

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || "test-secret-for-jest";
const buyerToken = jwt.sign({ id: 2, role: "buyer" }, SECRET);
const farmerToken = jwt.sign({ id: 1, role: "farmer" }, SECRET);

const paidOrder = { id: 10, buyer_id: 2, product_id: 5, status: "paid" };

describe("POST /api/reviews", () => {
  it("buyer can submit a review for a paid order", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(paidOrder).mockReturnValueOnce(null);
    mockRun.mockReturnValueOnce({ lastInsertRowid: 1 });

    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 5, comment: "Great product!" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(1);
  });

  it("returns 403 when farmer tries to submit a review", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${farmerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 4 });
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/reviews")
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 4 });
    expect(res.status).toBe(401);
  });

  it("returns 403 when order is not paid or not owned by buyer", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(null);
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 99, rating: 3 });
    expect(res.status).toBe(403);
  });

  it("returns 409 for duplicate review on same order", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(paidOrder).mockReturnValueOnce({ id: 7 });
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 4 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("duplicate_review");
  });

  it("returns 400 for rating below 1", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for rating above 5", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 6 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-integer rating", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ order_id: 10, rating: 3.5 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when order_id is missing", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/reviews")
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf)
      .send({ rating: 4 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/products/:id/reviews", () => {
  it("returns reviews for a product", async () => {
    mockAll.mockReturnValueOnce([
      {
        id: 1,
        rating: 5,
        comment: "Excellent",
        reviewer_name: "Alice",
        created_at: "2025-01-01",
      },
    ]);
    const res = await request(app).get("/api/products/5/reviews");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].reviewer_name).toBe("Alice");
  });

  it("returns empty array when no reviews exist", async () => {
    mockAll.mockReturnValueOnce([]);
    const res = await request(app).get("/api/products/5/reviews");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
