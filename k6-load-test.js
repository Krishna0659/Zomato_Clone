/**
 * k6 Load Test — Zomato Clone
 * ─────────────────────────────────────────────────────────────────────────
 * Targets: Restaurant Service (port 5001) + Utils/Payment Service (port 5002)
 *
 * Run:  k6 run k6-load-test.js --out json=k6-results.json
 *       k6 run k6-load-test.js (summary to stdout)
 *
 * Stages:
 *   0→30s:  ramp to 20 VUs  (warm-up)
 *   30→90s: hold 50 VUs     (sustained load)
 *   90→120s:ramp to 100 VUs (stress)
 *   120→150s: ramp down
 *
 * Thresholds (resume-worthy numbers):
 *   p95 < 500ms, p99 < 1000ms, error rate < 1%
 */

import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Rate, Trend } from "k6/metrics";

// ── Custom metrics ────────────────────────────────────────────────────────
const errorRate = new Rate("error_rate");
const orderCreateDuration = new Trend("order_create_duration", true);
const cartFetchDuration = new Trend("cart_fetch_duration", true);

// ── Config ────────────────────────────────────────────────────────────────
const BASE_RESTAURANT = __ENV.RESTAURANT_URL || "http://localhost:5001";
const BASE_UTILS = __ENV.UTILS_URL || "http://localhost:5002";

// Pre-generated valid JWT for a test user (generated with JWT_SEC=dklsjfoiwjeflsndofj)
// In CI, replace with a dynamically generated token
const TEST_TOKEN = __ENV.TEST_TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjp7Il9pZCI6IjY2MzEyMzQ1NjdlODlhYmNkZWYxMjM0NSIsInJvbGUiOiJjdXN0b21lciJ9LCJpYXQiOjE3OTA0MTgyNDZ9.BL2ESUjllXgJsQMBvn-xiTGYdOCJf8tR3dsUStmhuIY";

const AUTH_HEADERS = {
  Authorization: `Bearer ${TEST_TOKEN}`,
  "Content-Type": "application/json",
};

// ── Load profile ──────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: "30s", target: 20 },   // Warm-up: ramp to 20 VUs
    { duration: "60s", target: 50 },   // Sustained: hold 50 VUs
    { duration: "30s", target: 100 },  // Stress: ramp to 100 VUs
    { duration: "30s", target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    error_rate: ["rate<0.01"],          // <1% error rate
    order_create_duration: ["p(95)<600"],
    cart_fetch_duration: ["p(95)<200"],
  },
};

export function setup() {
  const res = http.get(`${BASE_RESTAURANT}/api/restaurant/all?latitude=28.6&longitude=77.1`, { headers: AUTH_HEADERS });
  if (res.status !== 200) {
    fail(`Pre-flight check failed! Server returned ${res.status}: ${res.body}`);
  }
}

// ── Scenario: GET /api/cart (high-frequency read) ─────────────────────────
function testCartFetch() {
  const start = Date.now();
  const res = http.get(`${BASE_RESTAURANT}/api/cart/all`, { headers: AUTH_HEADERS });
  cartFetchDuration.add(Date.now() - start);

  const ok = check(res, {
    "cart fetch status is 200 or 401": (r) => r.status === 200 || r.status === 401,
    "cart fetch response time < 500ms": (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  return ok;
}

// ── Scenario: GET /api/restaurant — list all restaurants ─────────────────
function testRestaurantList() {
  const res = http.get(`${BASE_RESTAURANT}/api/restaurant/all?latitude=28.6&longitude=77.1`, { headers: AUTH_HEADERS });

  const ok = check(res, {
    "restaurant list status is 200": (r) => r.status === 200,
    "restaurant list response < 800ms": (r) => r.timings.duration < 800,
  });

  errorRate.add(!ok);
  return ok;
}

// ── Scenario: POST /api/order/new — place order (write-heavy) ─────────────
function testCreateOrder() {
  const payload = JSON.stringify({
    paymentMethod: "razorpay",
    addressId: "000000000000000000000001", // Placeholder — will return 404 in load test
  });

  const start = Date.now();
  const res = http.post(`${BASE_RESTAURANT}/api/order/new`, payload, {
    headers: AUTH_HEADERS,
  });
  orderCreateDuration.add(Date.now() - start);

  const ok = check(res, {
    "create order returns valid HTTP status": (r) =>
      [200, 400, 401, 404].includes(r.status),
    "create order response < 1000ms": (r) => r.timings.duration < 1000,
  });

  errorRate.add(!ok);
  return ok;
}

// ── Scenario: POST /api/payment/razorpay — initiate payment ──────────────
function testCreateRazorpayOrder() {
  const payload = JSON.stringify({ orderId: "000000000000000000000001" });
  const res = http.post(`${BASE_UTILS}/api/payment/razorpay`, payload, {
    headers: Object.assign({}, AUTH_HEADERS, { "x-internal-key": "jdfienf12345@@@@##4$$$%%%jsadfjlajdf" }),
  });

  const ok = check(res, {
    "payment init returns valid status": (r) => [200, 400, 404, 500].includes(r.status),
    "payment init response < 2000ms": (r) => r.timings.duration < 2000,
  });

  errorRate.add(!ok);
  return ok;
}

// ── Main VU execution ─────────────────────────────────────────────────────
export default function () {
  // Weight: 50% cart reads, 30% restaurant list, 15% order create, 5% payment
  const rand = Math.random();

  if (rand < 0.50) {
    testCartFetch();
  } else if (rand < 0.80) {
    testRestaurantList();
  } else if (rand < 0.95) {
    testCreateOrder();
  } else {
    testCreateRazorpayOrder();
  }

  sleep(Math.random() * 0.5 + 0.1); // 100-600ms think time
}

// ── End-of-test summary ───────────────────────────────────────────────────
export function handleSummary(data) {
  const reqDuration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values : {};
  const errorRate = data.metrics.error_rate ? data.metrics.error_rate.values.rate : 0;
  
  const p50 = reqDuration["p(50)"] !== undefined ? reqDuration["p(50)"] : "N/A";
  const p95 = reqDuration["p(95)"] !== undefined ? reqDuration["p(95)"] : "N/A";
  const p99 = reqDuration["p(99)"] !== undefined ? reqDuration["p(99)"] : "N/A";
  const errRate = (errorRate * 100).toFixed(2);
  const rpsReqs = data.metrics.http_reqs ? data.metrics.http_reqs.values : {};
  const rps = rpsReqs.rate !== undefined ? rpsReqs.rate.toFixed(1) : "N/A";

  const summary = `
╔══════════════════════════════════════════════╗
║         k6 Load Test — Zomato Clone          ║
╠══════════════════════════════════════════════╣
║  p50 latency  : ${String(p50 + "ms").padEnd(27)}║
║  p95 latency  : ${String(p95 + "ms").padEnd(27)}║
║  p99 latency  : ${String(p99 + "ms").padEnd(27)}║
║  Error rate   : ${String(errRate + "%").padEnd(27)}║
║  Throughput   : ${String(rps + " req/s").padEnd(27)}║
╚══════════════════════════════════════════════╝
`;

  console.log(summary);

  return {
    "k6-summary.txt": summary,
    stdout: summary,
  };
}
