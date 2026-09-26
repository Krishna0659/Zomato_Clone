/**
 * RESTAURANT SERVICE — Unit Tests
 * Tests: isAuth/isSeller middleware, order state machine, cart controller logic
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.JWT_SEC = "test_jwt_secret";
process.env.INTERNAL_SERVICE_KEY = "test_internal_key";
process.env.REALTIME_SERVICE = "http://localhost:5004";

import { isAuth, isSeller } from "../src/middlewares/isAuth";
jest.mock("../src/config/db", () => jest.fn());

// ── helpers ────────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId().toString(),
  name: "Test",
  email: "test@test.com",
  image: "img",
  role: "customer",
  restaurantId: "",
  ...overrides,
});

const signToken = (user: object) =>
  jwt.sign({ user }, process.env.JWT_SEC!, { expiresIn: "15d" });

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};
const next: NextFunction = jest.fn();

// ═══════════════════════════════════════════════════════════════════════════
describe("isAuth middleware (restaurant service)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 — no Authorization header", async () => {
    const req: any = { headers: {} };
    await isAuth(req, mockRes(), next);
    expect(next).not.toHaveBeenCalled();
  });

  it("500 — malformed JWT", async () => {
    const req: any = { headers: { authorization: "Bearer bad.token" } };
    const res = mockRes();
    await isAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("passes with valid token and attaches user", async () => {
    const user = makeUser();
    const token = signToken(user);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    await isAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.email).toBe(user.email);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("isSeller middleware", () => {
  beforeEach(() => jest.clearAllMocks());

  it("blocks non-seller roles", async () => {
    const req: any = { user: makeUser({ role: "customer" }) };
    const res = mockRes();
    await isSeller(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks rider role", async () => {
    const req: any = { user: makeUser({ role: "rider" }) };
    const res = mockRes();
    await isSeller(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows seller role", async () => {
    const req: any = { user: makeUser({ role: "seller" }) };
    await isSeller(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Order state machine — updateOrderStatus (unit, mocked)", () => {
  // Mock Order and Restaurant models
  const mockOrder = {
    status: "placed",
    paymentStatus: "paid",
    restaurantId: "rest123",
    userId: "user123",
    _id: new mongoose.Types.ObjectId(),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const mockRestaurant = {
    _id: "rest123",
    ownerId: "user123",
    autoLocation: { type: "Point", coordinates: [77.0, 28.5], formattedAddress: "Delhi" },
    name: "Test Restaurant",
  };

  jest.mock("../src/models/Order", () => ({ findById: jest.fn() }));
  jest.mock("../src/models/Restaurant", () => ({ findById: jest.fn() }));
  jest.mock("axios", () => ({ post: jest.fn().mockResolvedValue({}) }));
  jest.mock("../src/config/order.publisher", () => ({ publishEvent: jest.fn() }));

  beforeEach(() => jest.clearAllMocks());

  const validTransitions = ["accepted", "preparing", "ready_for_rider"];
  const invalidTransitions = ["delivered", "picked_up", "rider_assigned", "cancelled", "placed"];

  invalidTransitions.forEach((status) => {
    it(`rejects illegal status transition: "${status}"`, async () => {
      const { updateOrderStatus } = await import("../src/controllers/order");
      const user = makeUser({ role: "seller" });
      const req: any = {
        user,
        params: { orderId: mockOrder._id.toString() },
        body: { status },
      };
      const res = mockRes();
      await updateOrderStatus(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Invalid order status" })
      );
    });
  });

  validTransitions.forEach((status) => {
    it(`allows valid transition: "${status}"`, async () => {
      const Order = (await import("../src/models/Order")).default;
      const Restaurant = (await import("../src/models/Restaurant")).default;
      const axios = (await import("axios")).default;

      const orderCopy = { ...mockOrder, status: "placed" };
      (Order.findById as jest.Mock).mockResolvedValue(orderCopy);
      (Restaurant.findById as jest.Mock).mockResolvedValue(mockRestaurant);
      (axios.post as jest.Mock).mockResolvedValue({});

      const { updateOrderStatus } = await import("../src/controllers/order");
      const user = makeUser({ _id: "user123", role: "seller" });
      const req: any = {
        user,
        params: { orderId: mockOrder._id.toString() },
        body: { status },
      };
      const res = mockRes();
      await updateOrderStatus(req, res, next);
      // Should NOT be 400
      expect(res.status).not.toHaveBeenCalledWith(400);
    });
  });

  it("rejects status update when paymentStatus is 'pending'", async () => {
    const Order = (await import("../src/models/Order")).default;
    (Order.findById as jest.Mock).mockResolvedValue({ ...mockOrder, paymentStatus: "pending" });

    const { updateOrderStatus } = await import("../src/controllers/order");
    const req: any = {
      user: makeUser({ _id: "user123" }),
      params: { orderId: "oid" },
      body: { status: "accepted" },
    };
    const res = mockRes();
    await updateOrderStatus(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Order not completed" })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("fetchOrderForPayment — internal key guard", () => {
  it("returns 403 without correct internal key", async () => {
    const { fetchOrderForPayment } = await import("../src/controllers/order");
    const req: any = {
      headers: { "x-internal-key": "wrong-key" },
      params: { id: "someId" },
    };
    const res = mockRes();
    await fetchOrderForPayment(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Forbidden" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Cart controller — addToCart validation (unit)", () => {
  it("returns 401 when user is missing", async () => {
    const { addToCart } = await import("../src/controllers/cart");
    const req: any = { user: null, body: {} };
    const res = mockRes();
    await addToCart(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 for invalid ObjectIds", async () => {
    const { addToCart } = await import("../src/controllers/cart");
    const req: any = {
      user: makeUser(),
      body: { restaurantId: "notanid", itemId: "alsonotanid" },
    };
    const res = mockRes();
    await addToCart(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Invalid") })
    );
  });
});
