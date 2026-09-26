import express from "express";
import request from "supertest";
import { ObjectId } from "mongodb";
import adminRoutes from "../src/routes/admin";

// Mock auth middleware
jest.mock("../src/middlewares/isAuth", () => ({
  isAuth: (req: any, res: any, next: any) => next(),
  isAdmin: (req: any, res: any, next: any) => next(),
}));

// We'll require the module after mocking it to override the methods
jest.mock("../src/util/collection", () => ({
  getRestaurantCollection: jest.fn(),
  getRiderCollection: jest.fn(),
}));

import { getRestaurantCollection, getRiderCollection } from "../src/util/collection";


const mockFindToArray = jest.fn();
const mockUpdateOne = jest.fn();

(getRestaurantCollection as jest.Mock).mockResolvedValue({
  find: jest.fn().mockReturnValue({ toArray: mockFindToArray }),
  updateOne: mockUpdateOne,
});

(getRiderCollection as jest.Mock).mockResolvedValue({
  find: jest.fn().mockReturnValue({ toArray: mockFindToArray }),
  updateOne: mockUpdateOne,
});

const app = express();
app.use(express.json());
app.use("/api/v1", adminRoutes);

describe("Admin Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should get pending restaurants", async () => {
    mockFindToArray.mockResolvedValue([{ _id: "1", isVerified: false }]);
    const res = await request(app).get("/api/v1/admin/restaurant/pending");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.restaurants.length).toBe(1);
  });

  it("should get pending riders", async () => {
    mockFindToArray.mockResolvedValue([{ _id: "1", isVerified: false }]);
    const res = await request(app).get("/api/v1/admin/rider/pending");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.riders.length).toBe(1);
  });

  it("should verify restaurant successfully", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
    const res = await request(app).patch(`/api/v1/verify/restaurant/${new ObjectId().toString()}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Restaurant verified successfully");
  });

  it("should return 400 for invalid restaurant id", async () => {
    const res = await request(app).patch("/api/v1/verify/restaurant/invalid-id");
    expect(res.status).toBe(400);
  });

  it("should return 404 if restaurant not found", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 0 });
    const res = await request(app).patch(`/api/v1/verify/restaurant/${new ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });

  it("should verify rider successfully", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
    const res = await request(app).patch(`/api/v1/verify/rider/${new ObjectId().toString()}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("rider verified successfully");
  });

  it("should return 400 for invalid rider id", async () => {
    const res = await request(app).patch("/api/v1/verify/rider/invalid-id");
    expect(res.status).toBe(400);
  });

  it("should return 404 if rider not found", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 0 });
    const res = await request(app).patch(`/api/v1/verify/rider/${new ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });
});
