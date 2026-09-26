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

jest.mock("../src/models/Cart", () => ({
  default: {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
  }
}));

import cartRoutes from "../src/routes/cart";
app.use("/api/cart", cartRoutes);

describe("Cart Error Coverage", () => {
  it("addToCart without user", async () => {
    await request(app).post("/api/cart/add").send({});
  });

  it("fetchCart without user", async () => {
    await request(app).get("/api/cart").send({});
  });

  it("increaseQuantity without user", async () => {
    await request(app).put("/api/cart/inc").send({});
  });

  it("decreaseQuantity without user", async () => {
    await request(app).put("/api/cart/dec").send({});
  });
  
  it("clearCart without user", async () => {
    await request(app).delete("/api/cart/clear").send({});
  });
});
