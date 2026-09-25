/**
 * RESTAURANT SERVICE — Integration Tests
 * Uses MONGO_TEST_URI env var (Docker MongoDB) — no binary download needed.
 * Run: MONGO_TEST_URI=mongodb://127.0.0.1:27018/restaurant_test npm test
 */
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";

process.env.JWT_SEC = "test_jwt_secret_integration";
process.env.INTERNAL_SERVICE_KEY = "test_internal_key";
process.env.REALTIME_SERVICE = "http://localhost:5004";
process.env.UTILS_SERVICE = "http://localhost:5002";

jest.mock("axios", () => ({
  default: {
    post: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({ data: {} }),
  },
  post: jest.fn().mockResolvedValue({ data: {} }),
  get: jest.fn().mockResolvedValue({ data: {} }),
}));

jest.mock("../src/config/rabbitmq", () => ({
  connectRabbitMQ: jest.fn().mockResolvedValue(undefined),
  getChannel: jest.fn().mockReturnValue({
    assertQueue: jest.fn(),
    consume: jest.fn(),
    sendToQueue: jest.fn(),
    ack: jest.fn(),
  }),
}));

jest.mock("../src/config/order.publisher", () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
}));

import restaurantRoutes from "../src/routes/restaraunt";
import itemRoutes from "../src/routes/menuitem";
import cartRoutes from "../src/routes/cart";
import addressRoutes from "../src/routes/address";
import orderRoutes from "../src/routes/order";
import Cart from "../src/models/Cart";
import Order from "../src/models/Order";
import Address from "../src/models/Address";

const MONGO_URI =
  process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27018/restaurant_test";

const buildApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/restaurant", restaurantRoutes);
  app.use("/api/item", itemRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/address", addressRoutes);
  app.use("/api/order", orderRoutes);
  return app;
};

let app: express.Express;

const makeUser = (overrides: any = {}) => ({
  _id: new mongoose.Types.ObjectId().toString(),
  name: "Test User",
  email: "test@test.com",
  image: "img",
  role: "customer",
  restaurantId: "",
  ...overrides,
});

const signToken = (user: object) =>
  jwt.sign({ user }, process.env.JWT_SEC!, { expiresIn: "15d" });

const authHeader = (user: object) => ({ Authorization: `Bearer ${signToken(user)}` });

beforeAll(async () => {
  await mongoose.connect(MONGO_URI);
  app = buildApp();
}, 30000);

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}, 15000);

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
  jest.clearAllMocks();
}, 10000);

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/cart — fetchMyCart", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/cart");
    expect(res.status).toBe(401);
  });

  it("returns empty cart for a new user", async () => {
    const user = makeUser();
    const res = await request(app).get("/api/cart").set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.cart).toHaveLength(0);
    expect(res.body.cartLength).toBe(0);
    expect(res.body.subtotal).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/cart — addToCart", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post("/api/cart").send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid ObjectIds", async () => {
    const user = makeUser();
    const res = await request(app)
      .post("/api/cart")
      .set(authHeader(user))
      .send({ restaurantId: "invalid", itemId: "invalid" });
    expect(res.status).toBe(400);
  });

  it("Cart compound unique index prevents duplicate raw inserts", async () => {
    const userId = new mongoose.Types.ObjectId();
    const restaurantId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();
    await Cart.createIndexes();
    await Cart.create({ userId, restaurantId, itemId });
    await expect(Cart.create({ userId, restaurantId, itemId }))
      .rejects.toThrow(/duplicate key/i);
  });

  it("upsert increments quantity on same item", async () => {
    const user = makeUser();
    const restId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();
    await Cart.create({ userId: user._id, restaurantId: restId, itemId });
    await Cart.findOneAndUpdate(
      { userId: user._id, restaurantId: restId, itemId },
      { $inc: { quauntity: 1 } },
      { upsert: true, new: true }
    );
    const cart = await Cart.findOne({ userId: user._id });
    expect(cart?.quauntity).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/order/new — createOrder validation", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post("/api/order/new").send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 when addressId is missing", async () => {
    const user = makeUser();
    const res = await request(app)
      .post("/api/order/new")
      .set(authHeader(user))
      .send({ paymentMethod: "razorpay" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/address/i);
  });

  it("returns 400 when cart is empty", async () => {
    const user = makeUser();
    const address = await Address.create({
      userId: user._id,
      formattedAddress: "123 Test St",
      mobile: 9999999999,
      location: { type: "Point", coordinates: [77.1, 28.6] },
    });
    const res = await request(app)
      .post("/api/order/new")
      .set(authHeader(user))
      .send({ paymentMethod: "razorpay", addressId: address._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cart is empty/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/order/payment/:id — fetchOrderForPayment", () => {
  it("returns 403 without internal key", async () => {
    const res = await request(app)
      .get("/api/order/payment/someid")
      .set("x-internal-key", "wrong");
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent order", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/order/payment/${fakeId}`)
      .set("x-internal-key", process.env.INTERNAL_SERVICE_KEY!);
    expect(res.status).toBe(404);
  });

  it("returns order amount for a pending payment order", async () => {
    const order = await Order.create({
      userId: "u1", restaurantId: "r1", restaurantName: "Test",
      distance: 2, riderAmount: 34, items: [],
      subtotal: 200, deliveryFee: 0, platfromFee: 7, totalAmount: 207,
      addressId: "a1",
      deliveryAddress: { fromattedAddress: "Test St", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
      paymentMethod: "razorpay", paymentStatus: "pending",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const res = await request(app)
      .get(`/api/order/payment/${order._id}`)
      .set("x-internal-key", process.env.INTERNAL_SERVICE_KEY!);
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(207);
  });

  it("returns 400 for already-paid order", async () => {
    const order = await Order.create({
      userId: "u1", restaurantId: "r1", restaurantName: "Test",
      distance: 2, riderAmount: 34, items: [],
      subtotal: 200, deliveryFee: 0, platfromFee: 7, totalAmount: 207,
      addressId: "a1",
      deliveryAddress: { fromattedAddress: "Test St", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
      paymentMethod: "razorpay", paymentStatus: "paid",
    });
    const res = await request(app)
      .get(`/api/order/payment/${order._id}`)
      .set("x-internal-key", process.env.INTERNAL_SERVICE_KEY!);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already paid/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Atomic rider assignment — race condition test", () => {
  it("two concurrent riders: exactly one wins the order", async () => {
    const order = await Order.create({
      userId: "u1", restaurantId: "r1", restaurantName: "Test",
      distance: 2, riderAmount: 34, riderId: null, items: [],
      subtotal: 200, deliveryFee: 0, platfromFee: 7, totalAmount: 207,
      addressId: "a1",
      deliveryAddress: { fromattedAddress: "Test", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
      paymentMethod: "razorpay", paymentStatus: "paid", status: "ready_for_rider",
    });

    const rider1 = new mongoose.Types.ObjectId().toString();
    const rider2 = new mongoose.Types.ObjectId().toString();

    const [r1, r2] = await Promise.all([
      Order.findOneAndUpdate(
        { _id: order._id, riderId: null },
        { riderId: rider1, status: "rider_assigned" },
        { new: true }
      ),
      Order.findOneAndUpdate(
        { _id: order._id, riderId: null },
        { riderId: rider2, status: "rider_assigned" },
        { new: true }
      ),
    ]);

    // Exactly one findOneAndUpdate returns a document; the other sees riderId already set
    const winners = [r1, r2].filter(Boolean);
    expect(winners).toHaveLength(1);

    const final = await Order.findById(order._id);
    expect([rider1, rider2]).toContain(final?.riderId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/order/myorder — getMyOrders", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/order/myorder");
    expect(res.status).toBe(401);
  });

  it("returns only paid orders for the authenticated user", async () => {
    const user = makeUser();
    const base = {
      userId: user._id, restaurantId: "r1", restaurantName: "R1",
      distance: 1, riderAmount: 17, items: [],
      subtotal: 100, deliveryFee: 49, platfromFee: 7, totalAmount: 156,
      addressId: "a1",
      deliveryAddress: { fromattedAddress: "T", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
    };
    await Order.create([
      { ...base, paymentMethod: "razorpay", paymentStatus: "paid" },
      { ...base, paymentMethod: "stripe", paymentStatus: "pending", expiresAt: new Date(Date.now() + 900000) },
    ]);
    const res = await request(app)
      .get("/api/order/myorder")
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].paymentStatus).toBe("paid");
  });
});
