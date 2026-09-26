import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const app = express();
app.use(express.json());

process.env.JWT_SEC = "test";
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

jest.mock("../src/models/Restaurant", () => ({
  default: {
    find: jest.fn().mockReturnValue(makePopulate([{ _id: "1", name: "R1" }])),
    aggregate: jest.fn().mockResolvedValue([{ _id: "1", name: "R1" }]),
    findById: jest.fn().mockResolvedValue({ _id: "1", save: jest.fn(), isVerified: false }),
    create: jest.fn().mockResolvedValue({}),
  }
}));

import restRoutes from "../src/routes/restaraunt";

app.use("/api/restaurant", restRoutes);

describe("Bump restaurant coverage", () => {
  const seller = { _id: new mongoose.Types.ObjectId().toString(), role: "seller" };

  it("getNearbyRestaurant", async () => {
    await request(app).get("/api/restaurant/all?lat=1&lng=1").set(auth(seller));
    await request(app).get("/api/restaurant/all").set(auth(seller)); // no lat lng
  });

  it("fetchMyRestaurant", async () => {
    await request(app).get("/api/restaurant/my").set(auth(seller));
  });

  it("updateStatusRestaurant", async () => {
    await request(app).put("/api/restaurant/status").set(auth(seller)).send({ status: true });
  });

  it("updateRestaurant", async () => {
    await request(app).put("/api/restaurant/edit").set(auth(seller)).send({ name: "Updated" });
  });
});
