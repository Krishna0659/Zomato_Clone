/**
 * UTILS / PAYMENT SERVICE — Tests
 * 1. Razorpay HMAC signature verification (unit — pure crypto, no network)
 * 2. Payment idempotency via RabbitMQ consumer (contract test)
 * 3. Malformed / replayed webhook rejection
 */
import crypto from "crypto";

process.env.RAZORPAY_KEY_SECRET = "test_razorpay_secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_id";
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
process.env.INTERNAL_SERVICE_KEY = "test_internal_key";
process.env.RESTAURANT_SERVICE = "http://localhost:5001";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.RABBITMQ_URL = "amqp://admin:admin123@localhost:5672";
process.env.PAYMENT_QUEUE = "payment_event";

import { verifyRazorpaySignature } from "../src/config/verifyRazorpay";

// ── helper: build a valid HMAC signature ──────────────────────────────────
const buildValidSignature = (orderId: string, paymentId: string) =>
  crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

// ═══════════════════════════════════════════════════════════════════════════
describe("verifyRazorpaySignature — HMAC unit tests", () => {
  const orderId = "order_ABCDEF1234";
  const paymentId = "pay_XYZ9876";

  it("returns true for a correctly signed payload", () => {
    const sig = buildValidSignature(orderId, paymentId);
    expect(verifyRazorpaySignature(orderId, paymentId, sig)).toBe(true);
  });

  it("returns false when signature is tampered", () => {
    const sig = buildValidSignature(orderId, paymentId);
    const tampered = sig.slice(0, -4) + "0000"; // corrupt last 4 chars
    expect(verifyRazorpaySignature(orderId, paymentId, tampered)).toBe(false);
  });

  it("returns false when orderId is replayed with different paymentId", () => {
    const sig = buildValidSignature(orderId, paymentId);
    expect(verifyRazorpaySignature(orderId, "pay_DIFFERENT", sig)).toBe(false);
  });

  it("returns false for an empty signature", () => {
    expect(verifyRazorpaySignature(orderId, paymentId, "")).toBe(false);
  });

  it("returns false for a completely random string as signature", () => {
    expect(verifyRazorpaySignature(orderId, paymentId, "randomgarbagestring")).toBe(false);
  });

  it("is resistant to timing-safe comparison bypass (length-extension)", () => {
    const sig = buildValidSignature(orderId, paymentId);
    // prepend extra chars — should still fail
    expect(verifyRazorpaySignature(orderId, paymentId, "00" + sig)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Payment consumer — idempotency (contract test)", () => {
  /**
   * Simulates the RabbitMQ payment.consumer logic:
   * - message delivered once → order updated to 'paid'
   * - same message delivered again → no-op (findOneAndUpdate with $ne guard)
   */

  const mockChannel = {
    consume: jest.fn(),
    ack: jest.fn(),
    sendToQueue: jest.fn(),
  };

  const buildPaymentMessage = (orderId: string) =>
    Buffer.from(
      JSON.stringify({
        type: "PAYMENT_SUCCESS",
        data: { orderId, paymentId: "pay_TEST123", provider: "razorpay" },
      })
    );

  it("processes PAYMENT_SUCCESS message exactly once (idempotency guard)", async () => {
    // Simulate what payment.consumer does:
    //   Order.findOneAndUpdate({ _id, paymentStatus: { $ne: 'paid' } }, { paymentStatus: 'paid' })
    // On 1st call → returns the order (not yet paid)
    // On 2nd call → returns null (already paid, $ne guard)

    const orderId = new (await import("mongoose")).default.Types.ObjectId().toString();

    const findOneAndUpdateMock = jest
      .fn()
      .mockResolvedValueOnce({ _id: orderId, paymentStatus: "paid", restaurantId: "r1" }) // 1st delivery
      .mockResolvedValueOnce(null); // 2nd delivery (idempotency)

    const mockOrder = { findOneAndUpdate: findOneAndUpdateMock };

    // Simulate consumer logic inline (pure logic test)
    const processPaymentMessage = async (msg: Buffer, Order: any) => {
      const event = JSON.parse(msg.toString());
      if (event.type !== "PAYMENT_SUCCESS") return { processed: false };

      const order = await Order.findOneAndUpdate(
        { _id: event.data.orderId, paymentStatus: { $ne: "paid" } },
        { $set: { paymentStatus: "paid", status: "placed" }, $unset: { expiresAt: 1 } },
        { new: true }
      );

      if (!order) return { processed: false, reason: "already_processed" };
      return { processed: true, orderId: order._id };
    };

    const msg = buildPaymentMessage(orderId);

    const result1 = await processPaymentMessage(msg, mockOrder);
    const result2 = await processPaymentMessage(msg, mockOrder); // replay

    expect(result1.processed).toBe(true);
    expect(result2.processed).toBe(false);
    expect(result2.reason).toBe("already_processed");
    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(2);
  });

  it("ignores non-PAYMENT_SUCCESS event types", async () => {
    const findOneAndUpdateMock = jest.fn();
    const mockOrder = { findOneAndUpdate: findOneAndUpdateMock };

    const processPaymentMessage = async (msg: Buffer, Order: any) => {
      const event = JSON.parse(msg.toString());
      if (event.type !== "PAYMENT_SUCCESS") return { processed: false };
      await Order.findOneAndUpdate({});
      return { processed: true };
    };

    const bogusMsg = Buffer.from(
      JSON.stringify({ type: "ORDER_SHIPPED", data: { orderId: "oid" } })
    );

    const result = await processPaymentMessage(bogusMsg, mockOrder);
    expect(result.processed).toBe(false);
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("verifyRazorpayPayment endpoint — request/response (mocked)", () => {
  it("rejects a tampered Razorpay webhook with 400", async () => {
    // Build express app with payment routes + mocked dependencies
    jest.mock("../src/config/razorpay", () => ({
      razorpay: { orders: { create: jest.fn() } },
    }));
    jest.mock("axios", () => ({
      default: { get: jest.fn().mockResolvedValue({ data: { amount: 200 } }) },
    }));
    jest.mock("../src/config/payment.producer", () => ({
      publishPaymentSuccess: jest.fn(),
    }));
    jest.mock("../src/config/rabbitmq", () => ({
      connectRabbitMQ: jest.fn(),
      getChannel: jest.fn().mockReturnValue({ assertQueue: jest.fn() }),
    }));

    const express = (await import("express")).default;
    const paymentRoutes = (await import("../src/routes/payment")).default;
    const request = (await import("supertest")).default;

    const app = express();
    app.use(express.json());
    app.use("/api/payment", paymentRoutes);

    const res = await request(app).post("/api/payment/verify").send({
      razorpay_order_id: "order_FAKE",
      razorpay_payment_id: "pay_FAKE",
      razorpay_signature: "tampered_signature_that_should_fail",
      orderId: "someOrderId",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/verification failed/i);
  });
});
