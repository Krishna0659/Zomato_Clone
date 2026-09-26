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
    findOne: jest.fn().mockImplementation((query) => {
      if (query.restaurantId && query.restaurantId.$ne) {
        return Promise.resolve({ _id: "cart1" }); // returns a cart from different restaurant
      }
      return Promise.resolve(null);
    }),
    create: jest.fn().mockResolvedValue({ items: [] }),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOneAndDelete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
  }
}));

import cartRoutes from "../src/routes/cart";

app.use("/api/cart", cartRoutes);

describe("Cart Coverage Full", () => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), role: "customer" };

  it("Cart add diff restaurant", async () => { 
    await request(app).post("/api/cart/add").set(auth(user)).send({ restaurantId: new mongoose.Types.ObjectId().toString(), itemId: new mongoose.Types.ObjectId().toString() }); 
  });
  
  it("Cart inc no cart", async () => { 
    await request(app).put("/api/cart/inc").set(auth(user)).send({ itemId: new mongoose.Types.ObjectId().toString() }); 
  });
  
  it("Cart dec no cart", async () => { 
    await request(app).put("/api/cart/dec").set(auth(user)).send({ itemId: new mongoose.Types.ObjectId().toString() }); 
  });
  
  it("Cart clear", async () => { 
    await request(app).delete("/api/cart/clear").set(auth(user)); 
  });
});
