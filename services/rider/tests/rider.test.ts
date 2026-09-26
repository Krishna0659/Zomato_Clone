/**
 * RIDER SERVICE — Tests
 * Uses MONGO_TEST_URI (Docker MongoDB) — no binary download.
 * Run: MONGO_TEST_URI=mongodb://127.0.0.1:27018/rider_test npm test
 */
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";

process.env.JWT_SEC = "test_jwt_secret_rider";
process.env.INTERNAL_SERVICE_KEY = "test_internal_key";
process.env.RESTAURANT_SERVICE = "http://localhost:5001";
process.env.REALTIME_SERVICE = "http://localhost:5004";
process.env.UTILS_SERVICE = "http://localhost:5002";

jest.mock("axios", () => {
  const mAxios = {
    post: jest.fn().mockResolvedValue({ data: { success: true, url: "http://image.com" } }),
    get: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: { success: true } }),
  };
  return {
    __esModule: true,
    default: mAxios,
    ...mAxios,
  };
});

jest.mock("../src/config/rabbitmq", () => ({
  connectRabbitMQ: jest.fn().mockResolvedValue(undefined),
  getChannel: jest.fn().mockReturnValue({
    assertQueue: jest.fn(),
    consume: jest.fn(),
    ack: jest.fn(),
  }),
}));

import { Rider } from "../src/model/Rider";
import riderRoutes from "../src/routes/rider";

const MONGO_URI =
  process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27018/rider_test?directConnection=true";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/rider", riderRoutes);
  return app;
};

let app: express.Express;

const makeUser = (overrides: any = {}) => ({
  _id: new mongoose.Types.ObjectId().toString(),
  name: "Rider One",
  email: "rider@test.com",
  image: "img",
  role: "rider",
  restaurantId: "",
  ...overrides,
});

const signToken = (user: object) =>
  jwt.sign({ user }, process.env.JWT_SEC!, { expiresIn: "15d" });

const authHeader = (user: object) => ({ Authorization: `Bearer ${signToken(user)}` });

beforeAll(async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27018/rider_test", {
        serverSelectionTimeoutMS: 5000,
        family: 4
      });
      break;
    } catch (err) {
      retries -= 1;
      console.log(`Mongoose connection failed. Retries left: ${retries}, error: ${(err as Error).message}`);
      if (retries === 0) throw err;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  app = buildApp();
}, 120000);

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
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
describe("PUT /api/rider/toggle — toggleRiderAvailability", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).patch("/api/rider/toggle").send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-rider role", async () => {
    const customer = makeUser({ role: "customer" });
    const res = await request(app)
      .patch("/api/rider/toggle")
      .set(authHeader(customer))
      .send({ isAvailble: true, latitude: 28.6, longitude: 77.1 });
    expect(res.status).toBe(403);
  });

  it("returns 400 when isAvailble is not boolean", async () => {
    const rider = makeUser({ role: "rider" });
    const res = await request(app)
      .patch("/api/rider/toggle")
      .set(authHeader(rider))
      .send({ isAvailble: "yes", latitude: 28.6, longitude: 77.1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/boolean/i);
  });

  it("returns 404 when rider profile does not exist", async () => {
    const rider = makeUser({ role: "rider" });
    const res = await request(app)
      .patch("/api/rider/toggle")
      .set(authHeader(rider))
      .send({ isAvailble: false, latitude: 28.6, longitude: 77.1 });
    expect(res.status).toBe(404);
  });

  it("returns 403 when unverified rider tries to go online", async () => {
    const user = makeUser({ role: "rider" });
    await Rider.create({
      userId: user._id, picture: "img", phoneNumber: "9999999999",
      aadharNumber: "1234-5678-9012", drivingLicenseNumber: "DL-1234",
      isVerified: false,
      location: { type: "Point", coordinates: [77.1, 28.6] },
    });
    const res = await request(app)
      .patch("/api/rider/toggle")
      .set(authHeader(user))
      .send({ isAvailble: true, latitude: 28.6, longitude: 77.1 });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not verified/i);
  });

  it("allows verified rider to go online and updates location", async () => {
    const user = makeUser({ role: "rider" });
    await Rider.create({
      userId: user._id, picture: "img", phoneNumber: "9999999999",
      aadharNumber: "1234-5678-9012", drivingLicenseNumber: "DL-1234",
      isVerified: true, isAvailble: false,
      location: { type: "Point", coordinates: [77.1, 28.6] },
    });
    const res = await request(app)
      .patch("/api/rider/toggle")
      .set(authHeader(user))
      .send({ isAvailble: true, latitude: 28.7, longitude: 77.2 });
    expect(res.status).toBe(200);
    expect(res.body.rider.isAvailble).toBe(true);
    expect(res.body.rider.location.coordinates).toEqual([77.2, 28.7]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/rider/myprofile — fetchMyProfile", () => {
  it("returns null for rider with no profile", async () => {
    const user = makeUser({ role: "rider" });
    const res = await request(app).get("/api/rider/myprofile").set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("returns the rider profile when it exists", async () => {
    const user = makeUser({ role: "rider" });
    await Rider.create({
      userId: user._id, picture: "img", phoneNumber: "9876543210",
      aadharNumber: "0000-1111-2222", drivingLicenseNumber: "DL-9876",
      isVerified: true,
      location: { type: "Point", coordinates: [77.5, 28.7] },
    });
    const res = await request(app).get("/api/rider/myprofile").set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.phoneNumber).toBe("9876543210");
    expect(res.body.isVerified).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Geospatial: Rider $near query — only riders within 500m returned", () => {
  const REFERENCE = { lng: 77.209, lat: 28.6139 };
  // ~100m north
  const RIDER_A = { lng: 77.209, lat: 28.6148 };
  // ~400m north
  const RIDER_B = { lng: 77.209, lat: 28.6175 };
  // ~1000m north — outside radius
  const RIDER_C = { lng: 77.209, lat: 28.6229 };

  beforeEach(async () => {
    await Rider.createIndexes();
    await Rider.create([
      {
        userId: "rider-a", picture: "img", phoneNumber: "111", aadharNumber: "1111",
        drivingLicenseNumber: "DL-A", isVerified: true, isAvailble: true,
        location: { type: "Point", coordinates: [RIDER_A.lng, RIDER_A.lat] },
      },
      {
        userId: "rider-b", picture: "img", phoneNumber: "222", aadharNumber: "2222",
        drivingLicenseNumber: "DL-B", isVerified: true, isAvailble: true,
        location: { type: "Point", coordinates: [RIDER_B.lng, RIDER_B.lat] },
      },
      {
        userId: "rider-c", picture: "img", phoneNumber: "333", aadharNumber: "3333",
        drivingLicenseNumber: "DL-C", isVerified: true, isAvailble: true,
        location: { type: "Point", coordinates: [RIDER_C.lng, RIDER_C.lat] },
      },
    ]);
  });

  it("returns only riders within 500m radius", async () => {
    const riders = await Rider.find({
      isAvailble: true, isVerified: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [REFERENCE.lng, REFERENCE.lat] },
          $maxDistance: 500,
        },
      },
    });
    const userIds = riders.map((r) => r.userId);
    expect(userIds).toContain("rider-a");
    expect(userIds).toContain("rider-b");
    expect(userIds).not.toContain("rider-c");
  });

  it("returns results in ascending distance order ($near is closest-first)", async () => {
    const riders = await Rider.find({
      isAvailble: true, isVerified: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [REFERENCE.lng, REFERENCE.lat] },
          $maxDistance: 500,
        },
      },
    });
    expect(riders.length).toBeGreaterThanOrEqual(2);
    if (riders.length >= 2) {
      expect(riders[0]!.userId).toBe("rider-a");
      expect(riders[1]!.userId).toBe("rider-b");
    }
  });

  it("excludes offline riders even if within radius", async () => {
    await Rider.create({
      userId: "rider-offline", picture: "img", phoneNumber: "444", aadharNumber: "4444",
      drivingLicenseNumber: "DL-OFF", isVerified: true, isAvailble: false,
      location: { type: "Point", coordinates: [77.209, 28.6141] },
    });
    const riders = await Rider.find({
      isAvailble: true, isVerified: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [REFERENCE.lng, REFERENCE.lat] },
          $maxDistance: 500,
        },
      },
    });
    expect(riders.map((r) => r.userId)).not.toContain("rider-offline");
  });
});

describe("POST /api/rider/new — addRiderProfile", () => {
  it("returns 201 and creates profile", async () => {
    const user = makeUser({ role: "rider" });
    const res = await request(app)
      .post("/api/rider/new")
      .set(authHeader(user))
      .field("phoneNumber", "1234567890")
      .field("aadharNumber", "1234")
      .field("drivingLicenseNumber", "DL123")
      .field("latitude", 28.6)
      .field("longitude", 77.1)
      .attach("file", Buffer.from("fake image"), "image.jpg");
    expect(res.status).toBe(201);
  });
});

describe("POST /api/rider/accept/:orderId — acceptOrder", () => {
  it("accepts order and marks rider unavailable", async () => {
    const user = makeUser({ role: "rider" });
    await Rider.create({
      userId: user._id, picture: "img", phoneNumber: "9876543210",
      aadharNumber: "0000", drivingLicenseNumber: "DL",
      isVerified: true, isAvailble: true,
      location: { type: "Point", coordinates: [77.5, 28.7] },
    });
    const res = await request(app)
      .post("/api/rider/accept/order_123")
      .set(authHeader(user));
    expect(res.status).toBe(200);
    const rider = await Rider.findOne({ userId: user._id });
    expect(rider?.isAvailble).toBe(false);
  });
});

describe("GET /api/rider/order/current — fetchMyCurrentOrder", () => {
  it("fetches current order", async () => {
    const user = makeUser({ role: "rider" });
    await Rider.create({
      userId: user._id, picture: "img", phoneNumber: "9876543210",
      aadharNumber: "0000", drivingLicenseNumber: "DL",
      isVerified: true, isAvailble: false,
      location: { type: "Point", coordinates: [77.5, 28.7] },
    });
    const res = await request(app)
      .get("/api/rider/order/current")
      .set(authHeader(user));
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/rider/order/update/:orderId — updateOrderStatus", () => {
  it("updates order status", async () => {
    const user = makeUser({ role: "rider" });
    await Rider.create({
      userId: user._id, picture: "img", phoneNumber: "9876543210",
      aadharNumber: "0000", drivingLicenseNumber: "DL",
      isVerified: true, isAvailble: false,
      location: { type: "Point", coordinates: [77.5, 28.7] },
    });
    const res = await request(app)
      .put("/api/rider/order/update/order_123")
      .set(authHeader(user));
    expect(res.status).toBe(200);
  });
});

