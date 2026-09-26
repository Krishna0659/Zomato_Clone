import express from "express";
import request from "supertest";
import internalRoute from "../src/routes/internal";

process.env.INTERNAL_SERVICE_KEY = "test_key";

jest.mock("../src/socket", () => {
  return {
    getIO: jest.fn().mockReturnValue({
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    }),
  };
});

const app = express();
app.use(express.json());
app.use("/api/v1/internal", internalRoute);

describe("Realtime Internal Routes", () => {
  it("should return 403 if internal key is missing or wrong", async () => {
    const res = await request(app).post("/api/v1/internal/emit").send({
      event: "test_event",
      room: "test_room",
      payload: {},
    });
    expect(res.status).toBe(403);
  });

  it("should return 400 if event or room is missing", async () => {
    const res = await request(app)
      .post("/api/v1/internal/emit")
      .set("x-internal-key", "test_key")
      .send({
        event: "test_event",
      });
    expect(res.status).toBe(400);
  });

  it("should return 200 and emit event", async () => {
    const res = await request(app)
      .post("/api/v1/internal/emit")
      .set("x-internal-key", "test_key")
      .send({
        event: "test_event",
        room: "test_room",
        payload: { msg: "hello" },
      });
    expect(res.status).toBe(200);
    expect(res.body.sucess).toBe(true);
  });
});
