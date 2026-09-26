/**
 * AUTH SERVICE — Unit Tests
 * Tests: isAuth middleware, addUserRole controller, myProfile, loginUser validation
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// ── env setup ──────────────────────────────────────────────────────────────
process.env.JWT_SEC = "test_jwt_secret_for_unit_tests";
process.env.MONGO_URI = "mongodb://127.0.0.1/test";

// ── middleware under test ──────────────────────────────────────────────────
jest.mock("../src/config/db", () => jest.fn());
import { isAuth } from "../src/middlewares/isAuth";

// ── helpers ────────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId().toString(),
  name: "Test User",
  email: "test@example.com",
  image: "https://pic.example.com/avatar.png",
  role: "customer",
  ...overrides,
});

const signToken = (payload: object, expiresIn: string | number = "15d") =>
  jwt.sign({ user: payload }, process.env.JWT_SEC!, { expiresIn } as any);

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const mockReq = (headers: Record<string, string> = {}): any => ({
  headers,
  body: {},
  params: {},
  query: {},
  user: undefined,
});

const next: NextFunction = jest.fn();

// ═══════════════════════════════════════════════════════════════════════════
describe("isAuth middleware", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when Authorization header is missing", async () => {
    const req = mockReq({});
    const res = mockRes();
    await isAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("No auth header") })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when header does not start with 'Bearer '", async () => {
    const req = mockReq({ authorization: "Token abc123" });
    const res = mockRes();
    await isAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 when token is malformed/invalid", async () => {
    const req = mockReq({ authorization: "Bearer not.a.valid.jwt" });
    const res = mockRes();
    await isAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 when token is expired", async () => {
    const token = signToken(makeUser(), -1); // expired 1 second ago
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    await isAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and sets req.user when token is valid", async () => {
    const user = makeUser();
    const token = signToken(user);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    await isAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user).toMatchObject({ email: user.email });
  });

  it("returns 401 when token payload has no 'user' field", async () => {
    // sign a token with no `.user` key
    const token = jwt.sign({ data: "someRandomPayload" }, process.env.JWT_SEC!);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    await isAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("loginUser controller — validation", () => {
  it("rejects requests with no code in body", async () => {
    // We test the guard logic directly without Google API by inspecting the
    // controller source shape — unit-level validation gate
    const { loginUser } = await import("../src/controllers/auth");
    const req: any = { body: {} };
    const res = mockRes();
    await loginUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("required") })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("addUserRole controller — role validation", () => {
  // Mock User model so tests don't need DB
  jest.mock("../src/model/User", () => ({
    __esModule: true,
    default: {
      findByIdAndUpdate: jest.fn(),
    },
  }));

  const validRoles = ["customer", "rider", "seller"];
  const invalidRoles = ["admin", "superuser", "god", "", "CUSTOMER"];

  invalidRoles.forEach((role) => {
    it(`rejects invalid role: "${role}"`, async () => {
      const { addUserRole } = await import("../src/controllers/auth");
      const user = makeUser();
      const req: any = { user, body: { role } };
      const res = mockRes();
      await addUserRole(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  it("returns 401 when req.user is missing", async () => {
    const { addUserRole } = await import("../src/controllers/auth");
    const req: any = { user: null, body: { role: "customer" } };
    const res = mockRes();
    await addUserRole(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("accepts valid roles without error on model call", async () => {
    const User = (await import("../src/model/User")).default;
    const mockUser = makeUser({ role: "rider" });
    (User.findByIdAndUpdate as jest.Mock).mockResolvedValueOnce(mockUser);

    const { addUserRole } = await import("../src/controllers/auth");
    const req: any = { user: makeUser(), body: { role: "rider" } };
    const res = mockRes();
    await addUserRole(req, res, next);
    // should not call status(400)
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("myProfile controller", () => {
  it("returns the user from req.user", async () => {
    const { myProfile } = await import("../src/controllers/auth");
    const user = makeUser();
    const req: any = { user };
    const res = mockRes();
    await myProfile(req, res, next);
    expect(res.json).toHaveBeenCalledWith(user);
  });
});
