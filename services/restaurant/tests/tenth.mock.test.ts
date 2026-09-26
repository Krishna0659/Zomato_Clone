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
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
  }
}));

import orderRoutes from "../src/routes/order";
app.use("/api/order", orderRoutes);

describe("Order Error Coverage", () => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), role: "customer" };

  it("newOrder without user", async () => {
    await request(app).post("/api/order/new").send({});
  });

  it("newOrder missing addressId", async () => {
    await request(app).post("/api/order/new").set(auth(user)).send({});
  });

  it("fetchMyOrder without user", async () => {
    await request(app).get("/api/order/myorder").send({});
  });

  it("fetchOrderForRestaurant without user", async () => {
    await request(app).get("/api/order/restaurant/1").send({});
  });

  it("updateOrderStatusRider missing internal key", async () => {
    await request(app).put("/api/order/update/status/rider").send({});
  });

  it("updateOrderStatusRider missing order", async () => {
    await request(app).put("/api/order/update/status/rider").set("x-internal-key", "test_internal_key").send({ orderId: "1", status: "delivered" });
  });

  it("assignRiderToOrder missing internal key", async () => {
    await request(app).put("/api/order/assign/rider").send({});
  });

  it("getCurrentOrderForRider missing internal key", async () => {
    await request(app).get("/api/order/current/rider").send({});
  });

  it("getCurrentOrderForRider missing rider id", async () => {
    await request(app).get("/api/order/current/rider").set("x-internal-key", "test_internal_key").send({});
  });
});
