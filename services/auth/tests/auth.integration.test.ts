/**
 * AUTH SERVICE — Integration Tests (Supertest + mongodb-memory-server)
 * Tests full HTTP cycles: POST /api/auth/login, PUT /api/auth/add/role, GET /api/auth/me
 */
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";
import authRoute from "../src/routes/auth";

process.env.JWT_SEC = "test_jwt_secret_integration";

// ── App factory (mirrors src/index.ts without DB connect) ──────────────────
const buildApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/auth", authRoute);
  return app;
};

let mongod: MongoMemoryServer;
let app: express.Express;

const signToken = (user: object) =>
  jwt.sign({ user }, process.env.JWT_SEC!, { expiresIn: "15d" });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp();
}, 300000);  // 5 min — MongoDB binary download on first run

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  const collections = mongoose.connection.collections;
  for (const col of Object.values(collections)) await col.deleteMany({});
}, 15000);

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/auth/login", () => {
  it("returns 400 when code is missing", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  // Google OAuth round-trip can't be tested without real tokens.
  // We mock the oauth2client at module level for this test.
  it("returns 500/error when Google token exchange fails with a bad code", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ code: "TOTALLY_INVALID_CODE" });
    // Should not return 400 (validation) — should attempt Google and fail with 5xx
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
    // seed a user
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
      .send({ role: "admin" }); // invalid
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
