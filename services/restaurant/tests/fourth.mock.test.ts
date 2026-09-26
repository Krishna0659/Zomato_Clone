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

const makePopulate = (data: any) => {
  const chainable: any = {};
  chainable.populate = jest.fn().mockReturnValue(chainable);
  chainable.sort = jest.fn().mockReturnValue(chainable);
  chainable.exec = jest.fn().mockResolvedValue(data);
  chainable.then = (res: any) => res(data);
  return chainable;
};

jest.mock("../src/config/db", () => jest.fn());
jest.mock("../src/config/rabbitmq", () => ({ connectRabbitMQ: jest.fn(), publishEvent: jest.fn() }));
jest.mock("axios", () => ({ default: { post: jest.fn().mockResolvedValue({ data: {} }) }, post: jest.fn().mockResolvedValue({ data: {} }) }));

jest.mock("../src/models/Order", () => ({
  default: {
    findOne: jest.fn().mockResolvedValue({ _id: "1", save: jest.fn(), status: "ready_for_rider", restaurantId: { autoLocation: {} } }),
    find: jest.fn().mockReturnValue(makePopulate([{ _id: "1", userId: "1", restaurantId: { name: "Test" }, status: "placed", save: jest.fn(), createdAt: new Date() }])),
    findById: jest.fn().mockReturnValue(makePopulate({ _id: "1", status: "placed", save: jest.fn(), userId: "1", restaurantId: { ownerId: "1" }, createdAt: new Date() })),
  }
}));

jest.mock("../src/models/Restaurant", () => ({
  default: {
    findById: jest.fn().mockResolvedValue({ _id: "1", ownerId: "1" }),
  }
}));

import orderRoutes from "../src/routes/order";
app.use("/api/order", orderRoutes);

describe("Order Coverage", () => {
  const seller = { _id: "1", role: "seller" };

  it("fetchOrderForRestaurant", async () => {
    await request(app).get("/api/order/restaurant/1").set(auth(seller));
  });

  it("updateOrderStatus", async () => {
    await request(app).put("/api/order/1").set(auth(seller)).send({ status: "ready_for_rider" });
  });

  it("assignRiderToOrder", async () => {
    await request(app).put("/api/order/assign/rider").set("x-internal-key", "test_internal_key").send({ orderId: "1", riderId: "1", riderName: "R", riderPhone: 123 });
  });
});
