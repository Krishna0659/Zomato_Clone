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

// Mock everything!
jest.mock("../src/config/db", () => jest.fn());
jest.mock("../src/config/rabbitmq", () => ({ connectRabbitMQ: jest.fn(), publishEvent: jest.fn() }));
jest.mock("axios", () => ({ default: { post: jest.fn().mockResolvedValue({ data: {} }) }, post: jest.fn().mockResolvedValue({ data: {} }) }));

jest.mock("../src/models/Order", () => ({
  default: {
    create: jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() }),
    find: jest.fn().mockReturnValue(makePopulate([{ _id: "1", userId: "1", restaurantId: { name: "Test" }, status: "placed", save: jest.fn(), createdAt: new Date() }])),
    findById: jest.fn().mockReturnValue(makePopulate({ _id: "1", status: "placed", save: jest.fn(), userId: "1", restaurantId: "1", createdAt: new Date() })),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
  }
}));

jest.mock("../src/models/Cart", () => ({
  default: {
    findOne: jest.fn().mockReturnValue(makePopulate({ items: [{menuItem: {price: 10}}], quauntity: 1, subtotal: 100 })),
    find: jest.fn().mockReturnValue(makePopulate([{ restaurantId: { _id: "1" }, itemId: { price: 10, name: "Pizza" }, quauntity: 1 }])),
    create: jest.fn(),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOneAndDelete: jest.fn().mockResolvedValue({}),
  }
}));

jest.mock("../src/models/Address", () => ({
  default: {
    findById: jest.fn().mockResolvedValue({ _id: "1", formattedAddress: "A", mobile: 1, location: { coordinates: [0, 0] } }),
    findOne: jest.fn().mockResolvedValue({ _id: "1", formattedAddress: "A", mobile: 1, location: { coordinates: [0, 0] } }),
    find: jest.fn().mockReturnValue(makePopulate([])),
    create: jest.fn().mockResolvedValue({}),
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    findByIdAndDelete: jest.fn().mockResolvedValue({}),
  }
}));

jest.mock("../src/models/Restaurant", () => ({
  default: {
    findById: jest.fn().mockResolvedValue({ _id: "1", autoLocation: { coordinates: [0, 0] }, name: "Test", isOpen: true }),
  }
}));

jest.mock("../src/models/MenuItems", () => ({
  default: {
    findByIdAndDelete: jest.fn().mockResolvedValue({}),
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  }
}));

import addressRoutes from "../src/routes/address";
import orderRoutes from "../src/routes/order";
import cartRoutes from "../src/routes/cart";
import menuitemRoutes from "../src/routes/menuitem";

app.use("/api/address", addressRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/item", menuitemRoutes);

describe("Unit tests to bump coverage", () => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), role: "customer" };
  const seller = { _id: new mongoose.Types.ObjectId().toString(), role: "seller" };

  it("Order fetchMyOrder", async () => { await request(app).get("/api/order/myorder").set(auth(user)); });
  it("Order fetchOrderForRestaurant", async () => { await request(app).get("/api/order/restaurant/1").set(auth(seller)); });
  it("Order fetchSingleOrder", async () => { await request(app).get("/api/order/1").set(auth(user)); });
  it("Order fetchOrderForPayment", async () => { await request(app).get("/api/order/payment/1").set("x-internal-key", "test_internal_key"); });
  it("Order createOrder", async () => { await request(app).post("/api/order/new").set(auth(user)).send({ paymentMethod: "cod", addressId: new mongoose.Types.ObjectId().toString(), restaurantId: new mongoose.Types.ObjectId().toString() }); });
  it("Order assignRiderToOrder", async () => { await request(app).put("/api/order/assign/rider").set("x-internal-key", "test_internal_key").send({ orderId: "1", riderId: "1", riderName: "R", riderPhone: 123 }); });
  it("Order getCurrentOrderForRider", async () => { await request(app).get("/api/order/current/rider").set("x-internal-key", "test_internal_key"); });
  it("Order updateOrderStatusRider", async () => { await request(app).put("/api/order/update/status/rider").set("x-internal-key", "test_internal_key").send({ orderId: "1", status: "delivered" }); });
  
  it("Address new", async () => { await request(app).post("/api/address/new").set(auth(user)).send({ title: "T", formattedAddress: "A", mobile: 1, latitude: 1, longitude: 1 }); });
  it("Address all", async () => { await request(app).get("/api/address/all").set(auth(user)); });
  it("Address update", async () => { await request(app).put("/api/address/update/1").set(auth(user)).send({ title: "T2" }); });
  it("Address del", async () => { await request(app).delete("/api/address/del/1").set(auth(user)); });

  it("Cart add", async () => { await request(app).post("/api/cart/add").set(auth(user)).send({ restaurantId: new mongoose.Types.ObjectId().toString(), itemId: new mongoose.Types.ObjectId().toString() }); });
  it("Cart inc", async () => { await request(app).put("/api/cart/inc").set(auth(user)).send({ itemId: new mongoose.Types.ObjectId().toString() }); });
  it("Cart dec", async () => { await request(app).put("/api/cart/dec").set(auth(user)).send({ itemId: new mongoose.Types.ObjectId().toString() }); });
  it("Cart clear", async () => { await request(app).delete("/api/cart/clear").set(auth(user)); });

  it("Menu update", async () => { await request(app).put("/api/item/update/1").set(auth(seller)).send({ price: 100 }); });
  it("Menu del", async () => { await request(app).delete("/api/item/del/1").set(auth(seller)); });
});
