/**
 * AUTH SERVICE — Integration Tests
 * Uses MONGO_TEST_URI env var (Docker) or falls back to mongodb-memory-server.
 * Run with: MONGO_TEST_URI=mongodb://127.0.0.1:27018/auth_test npm test
 */
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";
import authRoute from "../src/routes/auth";

// ── env ──────────────────────────────────────────────────────────────────
process.env.JWT_SEC = "test_jwt_secret_integration";

const MONGO_URI =
  process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27018/auth_test";

// ── App factory ───────────────────────────────────────────────────────────
const buildApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/auth", authRoute);
  return app;
};

let app: express.Express;

const signToken = (user: object) =>
  jwt.sign({ user }, process.env.JWT_SEC!, { expiresIn: "15d" });

// ── Lifecycle ─────────────────────────────────────────────────────────────
beforeAll(async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(MONGO_URI);
      break;
    } catch (err) {
      retries -= 1;
      console.log(`Mongoose connection failed. Retries left: ${retries}`);
      if (retries === 0) throw err;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  app = buildApp();
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
}, 15000);

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  const collections = mongoose.connection.collections;
  for (const col of Object.values(collections)) await col.deleteMany({});
}, 10000);

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/auth/login", () => {
  it("returns 400 when code is missing", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  it("returns an error (400 or 500) when Google token exchange fails with a bad code", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ code: "TOTALLY_INVALID_CODE" });
    expect([400, 500]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("PUT /api/auth/add/role", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).put("/api/auth/add/role").send({ role: "customer" });
    expect(res.status).toBe(401);
  });

  it("returns 500 with a malformed token", async () => {
    const res = await request(app)
      .put("/api/auth/add/role")
      .set("Authorization", "Bearer bad.token.here")
      .send({ role: "customer" });
    expect(res.status).toBe(500);
  });

  it("returns 400 for an invalid role even with valid token", async () => {
    const User = mongoose.model("User");
    const user = await User.create({
      name: "Alice",
      email: "alice@test.com",
      image: "https://img",
    });
    const token = signToken(user.toObject());
    const res = await request(app)
      .put("/api/auth/add/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "admin" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid role/i);
  });

  it("updates role and returns new token for valid role", async () => {
    const User = mongoose.model("User");
    const user = await User.create({
      name: "Bob",
      email: "bob@test.com",
      image: "https://img",
    });
    const token = signToken(user.toObject());
    const res = await request(app)
      .put("/api/auth/add/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "rider" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user.role).toBe("rider");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/auth/me", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the user object with valid token", async () => {
    const User = mongoose.model("User");
    const user = await User.create({
      name: "Carol",
      email: "carol@test.com",
      image: "https://img",
      role: "customer",
    });
    const token = signToken(user.toObject());
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("carol@test.com");
  });
});
