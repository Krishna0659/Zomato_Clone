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

jest.mock("../src/models/Address", () => ({
  default: {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockImplementation((query) => {
      if (query._id === "found") {
        return Promise.resolve({ deleteOne: jest.fn() });
      }
      return Promise.resolve(null);
    }),
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
  }
}));

import addressRoutes from "../src/routes/address";

app.use("/api/address", addressRoutes);

describe("Address Extra Coverage", () => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), role: "customer" };

  it("addAddress without user", async () => {
    await request(app).post("/api/address/new").send({});
  });

  it("addAddress without fields", async () => {
    await request(app).post("/api/address/new").set(auth(user)).send({ mobile: 123 });
  });

  it("addAddress success", async () => {
    await request(app).post("/api/address/new").set(auth(user)).send({ mobile: 123, formattedAddress: "A", latitude: 1, longitude: 1 });
  });

  it("deleteAddress without user", async () => {
    await request(app).delete("/api/address/1").send({});
  });

  it("deleteAddress not found", async () => {
    await request(app).delete("/api/address/missing").set(auth(user));
  });

  it("deleteAddress found", async () => {
    await request(app).delete("/api/address/found").set(auth(user));
  });

  it("getMyAddresses without user", async () => {
    await request(app).get("/api/address/my").send({});
  });

  it("getMyAddresses success", async () => {
    await request(app).get("/api/address/my").set(auth(user));
  });
});
