const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  request,
  app,
  mockGet,
  mockRun,
  mockPrepare,
  getCsrf,
} = require("./setup");

beforeEach(() => jest.clearAllMocks());

const SECRET = process.env.JWT_SECRET || "test-secret-for-jest";
const token = (id, role) => jwt.sign({ id, role }, SECRET);

// Compliant with updated password rules: min 8 chars, 1 uppercase, 1 number
const VALID_PASSWORD = "Secure1pass";

describe("POST /api/auth/register", () => {
  it("registers a new user, returns access token and sets refresh cookie", async () => {
    mockRun.mockReturnValueOnce({ lastInsertRowid: 1 });
    const res = await request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@test.com",
      password: VALID_PASSWORD,
      role: "farmer",
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe("farmer");
    const cookie = res.headers["set-cookie"]?.[0] || "";
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("returns 409 on duplicate email", async () => {
    mockRun.mockImplementationOnce(() => {
      throw new Error("UNIQUE constraint failed");
    });
    const res = await request(app).post("/api/auth/register").send({
      name: "Bob",
      email: "bob@test.com",
      password: VALID_PASSWORD,
      role: "buyer",
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid role", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "X",
      email: "x@test.com",
      password: VALID_PASSWORD,
      role: "admin",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for password shorter than 8 chars", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Y",
      email: "y@test.com",
      password: "Short1",
      role: "farmer",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for password missing uppercase", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Y",
      email: "y@test.com",
      password: "nouppercase1",
      role: "farmer",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for password missing number", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Y",
      email: "y@test.com",
      password: "NoNumberHere",
      role: "farmer",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a common weak password", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Y",
      email: "y@test.com",
      password: "Password1",
      role: "farmer",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials, returns access token and sets refresh cookie", async () => {
    const hashed = await bcrypt.hash(VALID_PASSWORD, 12);
    mockGet.mockReturnValueOnce({
      id: 1,
      name: "Carol",
      email: "carol@test.com",
      password: hashed,
      role: "buyer",
      stellar_public_key: "GPUB",
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "carol@test.com", password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const decoded = jwt.verify(res.body.token, SECRET);
    expect(decoded.id).toBe(1);
    const cookie = res.headers["set-cookie"]?.[0] || "";
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("returns 401 for wrong password", async () => {
    const hashed = await bcrypt.hash(VALID_PASSWORD, 12);
    mockGet.mockReturnValueOnce({ id: 1, password: hashed, role: "buyer" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "carol@test.com", password: "wrongpass" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown email", async () => {
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.com", password: VALID_PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/refresh", () => {
  it("returns 401 when no refresh cookie is present", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookieStr)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid/unknown refresh token", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    mockGet.mockReturnValueOnce(undefined);
    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `${cookieStr}; refreshToken=invalidtoken`)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the refresh cookie on logout", async () => {
    const { token: csrf, cookieStr } = await getCsrf();
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", `${cookieStr}; refreshToken=sometoken`)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const cookie = res.headers["set-cookie"]?.[0] || "";
    expect(cookie).toMatch(/refreshToken=/);
  });
});
