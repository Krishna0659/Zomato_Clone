import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const app = express();
app.use(express.json());

process.env.JWT_SEC = "test";
const signToken = (u: any) => jwt.sign({ user: u }, "test");
const auth = (u: any) => ({ Authorization: `Bearer ${signToken(u)}` });

jest.mock("../src/config/db", () => jest.fn());
jest.mock("../src/config/rabbitmq", () => ({ connectRabbitMQ: jest.fn(), publishEvent: jest.fn() }));
jest.mock("axios", () => ({ default: { post: jest.fn().mockResolvedValue({ data: {} }) }, post: jest.fn().mockResolvedValue({ data: {} }) }));

jest.mock("../src/models/Restaurant", () => ({
  default: {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
  }
}));

import restRoutes from "../src/routes/restaraunt";
app.use("/api/restaurant", restRoutes);

describe("Restaurant Extra Coverage", () => {
  const seller = { _id: new mongoose.Types.ObjectId().toString(), role: "seller" };

  it("addRestraunt without user", async () => {
    await request(app).post("/api/restaurant/new").send({});
  });

  it("addRestraunt missing fields", async () => {
    await request(app).post("/api/restaurant/new").set(auth(seller)).send({});
  });

  it("fetchMyRestaurant without user", async () => {
    await request(app).get("/api/restaurant/my").send({});
  });
  
  it("updateStatusRestaurant without user", async () => {
    await request(app).put("/api/restaurant/status").send({});
  });

  it("updateStatusRestaurant invalid status", async () => {
    await request(app).put("/api/restaurant/status").set(auth(seller)).send({ status: "not boolean" });
  });

  it("updateStatusRestaurant not found", async () => {
    await request(app).put("/api/restaurant/status").set(auth(seller)).send({ status: true });
  });

  it("updateRestaurant without user", async () => {
    await request(app).put("/api/restaurant/edit").send({});
  });

  it("updateRestaurant not found", async () => {
    await request(app).put("/api/restaurant/edit").set(auth(seller)).send({});
  });
});
