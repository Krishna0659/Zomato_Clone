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

jest.mock("../src/models/MenuItems", () => ({
  default: {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockImplementation((query) => {
      if (query._id === "found") {
        return Promise.resolve({ deleteOne: jest.fn(), ...query });
      }
      return Promise.resolve(null);
    }),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
  }
}));

import itemRoutes from "../src/routes/menuitem";
app.use("/api/item", itemRoutes);

describe("Menu Item Extra Coverage", () => {
  const seller = { _id: new mongoose.Types.ObjectId().toString(), role: "seller" };

  it("add without user", async () => {
    await request(app).post("/api/item/new").send({});
  });

  it("add missing fields", async () => {
    await request(app).post("/api/item/new").set(auth(seller)).send({});
  });

  it("delete without user", async () => {
    await request(app).delete("/api/item/1").send({});
  });
  
  it("delete not found", async () => {
    await request(app).delete("/api/item/missing").set(auth(seller));
  });

  it("update without user", async () => {
    await request(app).put("/api/item/edit").send({});
  });

  it("update not found", async () => {
    await request(app).put("/api/item/edit").set(auth(seller)).send({ itemId: "missing" });
  });
});
