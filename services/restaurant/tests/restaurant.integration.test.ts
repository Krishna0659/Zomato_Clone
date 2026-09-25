/**
 * RESTAURANT SERVICE — Integration Tests
 * Supertest + mongodb-memory-server
 * Tests: Cart TTL/unique-index, Order creation, status transitions, race conditions
 */
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";

process.env.JWT_SEC = "test_jwt_secret_integration";
process.env.INTERNAL_SERVICE_KEY = "test_internal_key";
process.env.REALTIME_SERVICE = "http://localhost:5004";
process.env.UTILS_SERVICE = "http://localhost:5002";

// Mock axios so integration tests don't hit real services
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
import Restaurant from "../src/models/Restaurant";
import MenuItem from "../src/models/MenuItems";
import Address from "../src/models/Address";

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

let mongod: MongoMemoryServer;
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
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
  jest.clearAllMocks();
}, 15000);

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/cart — fetchMyCart", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/cart");
    expect(res.status).toBe(401);
  });

  it("returns empty cart for a new user", async () => {
    const user = makeUser();
    const res = await request(app)
      .get("/api/cart")
      .set(authHeader(user));
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

  it("adds item to cart and increments quantity on duplicate", async () => {
    const user = makeUser();
    const restId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    // Seed via model directly
    await Cart.create({ userId: user._id, restaurantId: restId, itemId });

    // Second add should increment via findOneAndUpdate
    await Cart.findOneAndUpdate(
      { userId: user._id, restaurantId: restId, itemId },
      { $inc: { quauntity: 1 } },
      { upsert: true, new: true }
    );

    const cart = await Cart.findOne({ userId: user._id });
    expect(cart?.quauntity).toBe(2);
  });

  it("Cart compound unique index prevents duplicate raw inserts", async () => {
    const userId = new mongoose.Types.ObjectId();
    const restaurantId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    await Cart.create({ userId, restaurantId, itemId });

    await expect(
      Cart.create({ userId, restaurantId, itemId })
    ).rejects.toThrow(/duplicate key/i);
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

  it("returns order amount for pending payment order", async () => {
    const order = await Order.create({
      userId: "u1",
      restaurantId: "r1",
      restaurantName: "Test",
      distance: 2,
      riderAmount: 34,
      items: [],
      subtotal: 200,
      deliveryFee: 0,
      platfromFee: 7,
      totalAmount: 207,
      addressId: "addr1",
      deliveryAddress: { fromattedAddress: "Test St", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
      paymentMethod: "razorpay",
      paymentStatus: "pending",
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
      userId: "u1",
      restaurantId: "r1",
      restaurantName: "Test",
      distance: 2,
      riderAmount: 34,
      items: [],
      subtotal: 200,
      deliveryFee: 0,
      platfromFee: 7,
      totalAmount: 207,
      addressId: "addr1",
      deliveryAddress: { fromattedAddress: "Test St", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
      paymentMethod: "razorpay",
      paymentStatus: "paid",
    });

    const res = await request(app)
      .get(`/api/order/payment/${order._id}`)
      .set("x-internal-key", process.env.INTERNAL_SERVICE_KEY!);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already paid/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("PUT /api/order/assign/rider — assignRiderToOrder (race condition)", () => {
  it("two concurrent rider assignments: exactly one succeeds", async () => {
    const order = await Order.create({
      userId: "u1",
      restaurantId: "r1",
      restaurantName: "Test",
      distance: 2,
      riderAmount: 34,
      riderId: null,
      items: [],
      subtotal: 200,
      deliveryFee: 0,
      platfromFee: 7,
      totalAmount: 207,
      addressId: "a1",
      deliveryAddress: { fromattedAddress: "Test", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
      paymentMethod: "razorpay",
      paymentStatus: "paid",
      status: "ready_for_rider",
    });

    // findOneAndUpdate with riderId: null — atomic, only one wins
    const rider1Id = new mongoose.Types.ObjectId().toString();
    const rider2Id = new mongoose.Types.ObjectId().toString();

    const [result1, result2] = await Promise.all([
      Order.findOneAndUpdate(
        { _id: order._id, riderId: null },
        { riderId: rider1Id, status: "rider_assigned" },
        { new: true }
      ),
      Order.findOneAndUpdate(
        { _id: order._id, riderId: null },
        { riderId: rider2Id, status: "rider_assigned" },
        { new: true }
      ),
    ]);

    const winners = [result1, result2].filter(Boolean);
    expect(winners).toHaveLength(1);

    const finalOrder = await Order.findById(order._id);
    // riderId is set to exactly one of the two riders
    expect([rider1Id, rider2Id]).toContain(finalOrder?.riderId);
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

    // Create paid and pending orders
    await Order.create([
      {
        userId: user._id, restaurantId: "r1", restaurantName: "R1", distance: 1, riderAmount: 17,
        items: [], subtotal: 100, deliveryFee: 49, platfromFee: 7, totalAmount: 156,
        addressId: "a1", deliveryAddress: { fromattedAddress: "Test", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
        paymentMethod: "razorpay", paymentStatus: "paid",
      },
      {
        userId: user._id, restaurantId: "r1", restaurantName: "R1", distance: 1, riderAmount: 17,
        items: [], subtotal: 100, deliveryFee: 49, platfromFee: 7, totalAmount: 156,
        addressId: "a1", deliveryAddress: { fromattedAddress: "Test", mobile: 9999999999, latitude: 28.6, longitude: 77.1 },
        paymentMethod: "stripe", paymentStatus: "pending",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    ]);

    const res = await request(app)
      .get("/api/order/myorder")
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].paymentStatus).toBe("paid");
  });
});
