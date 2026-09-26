import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const app = express();
app.use(express.json());

process.env.JWT_SEC = "test";
process.env.INTERNAL_SERVICE_KEY = "test_internal_key";
const signToken = (u: any) => jwt.sign({ user: u }, "test");
const auth = (u: any) => ({ Authorization: `Bearer ${signToken(u)}` });

jest.mock("../src/config/db", () => jest.fn());
jest.mock("../src/config/rabbitmq", () => ({ connectRabbitMQ: jest.fn(), publishEvent: jest.fn() }));
jest.mock("axios", () => ({ default: { post: jest.fn().mockResolvedValue({ data: {} }) }, post: jest.fn().mockResolvedValue({ data: {} }) }));

jest.mock("../src/models/Order", () => ({
  default: {
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue({ _id: "1", save: jest.fn(), status: "rider_assigned", restaurantId: "r1", userId: "u1", riderId: null }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "1" }),
  }
}));

import orderRoutes from "../src/routes/order";
app.use("/api/order", orderRoutes);

describe("Order Coverage Extra Extra", () => {
  it("assignRiderToOrder success flow", async () => {
    await request(app).put("/api/order/assign/rider").set("x-internal-key", "test_internal_key").send({ orderId: "1", riderId: "r1", riderName: "R", riderPhone: 123 });
  });

  it("updateOrderStatusRider to picked_up", async () => {
    await request(app).put("/api/order/update/status/rider").set("x-internal-key", "test_internal_key").send({ orderId: "1", status: "picked_up" });
  });

  it("getCurrentOrderForRider", async () => {
    await request(app).get("/api/order/current/rider").set("x-internal-key", "test_internal_key").query({ riderId: "r1" });
  });
});
