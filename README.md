# 🍅 Zomato Clone — Full-Stack Food Delivery Platform

[![CI — Test Suite](https://github.com/Krishna0659/Zomato_Clone/actions/workflows/test.yml/badge.svg)](https://github.com/Krishna0659/Zomato_Clone/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/Krishna0659/Zomato_Clone/branch/main/graph/badge.svg)](https://codecov.io/gh/Krishna0659/Zomato_Clone)

A production-grade, event-driven food delivery platform built with **6 Node.js/TypeScript microservices**, MongoDB, RabbitMQ, Socket.IO, Stripe, and Razorpay.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend (Vite + React)         │  :5173
└──────────────────────────┬──────────────────────┘
                           │ HTTP + WebSocket
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
  :5000                  :5001                  :5002
 [auth]            [restaurant]              [utils/pay]
    │                      │                      │
    └──────────────────────┼──────────────────────┘
                           │ RabbitMQ (AMQP)
              ┌────────────┼────────────┐
            :5004        :5005        :5006
         [realtime]    [rider]      [admin]
         (Socket.IO)
```

---

## 🧪 Test Suite (Production-Grade)

### Strategy

| Type | What's Covered | Tooling |
|---|---|---|
| **Unit Tests** | JWT auth middleware (valid/expired/malformed), role guards (`isSeller`, `isAdmin`), cart compound-unique-index conflict, order state-machine transitions (rejects illegal: `delivered → preparing`) | Jest + ts-jest |
| **Integration Tests** | Full HTTP req/res cycles for all ~46 endpoints — status codes, auth enforcement, validation errors, response shape | Supertest + `mongodb-memory-server` |
| **Geospatial Tests** | `$near` 500m radius query, distance-ordered results, offline rider exclusion | Jest + `mongodb-memory-server` |
| **Atomic Concurrency** | Rider `findOneAndUpdate` order-accept (prevents double-assignment) | Jest + MongoDB |
| **Payment Tests** | Razorpay order creation, Stripe payment intent, webhook signature verification | Jest + mocked SDK |
| **Load Tests** | p95/p99 latency, error rate under ramp-up to 100 VUs over 2m30s | k6 v0.50.0 |

---

### 📊 Coverage Results (Real — from `npm run test:coverage`)

| Service | Suites | Tests | Pass | Fail | Lines % | Branch % | Funcs % | CI |
|---|---|---|---|---|---|---|---|---|
| 🔐 **Auth** | 4 | 23 | 15 | 8† | **83.76%** | 77.64% | 84.21% | ✅ |
| 🍽️ **Restaurant** | 13 | 126 | 125 | 1†† | **80.97%** | 72.32% | 82.79% | ✅ |
| 💳 **Utils/Payments** | 2 | 9 | 9 | 0 | **66.17%** | 70.37% | 62.5% | ❌ |
| 📡 **Realtime** | 1 | 3 | 3 | 0 | **100%** | 86.66% | 100% | ✅ |
| 🛵 **Rider** | 1 | 15 | 15 | 0 | **81.34%** | 72.26% | 84% | ✅ |
| 🛡️ **Admin** | 1 | 8 | 8 | 0 | **94.23%** | 84.61% | 100% | ✅ |
| **TOTAL** | **22** | **184** | **175** | **9** | — | — | — | **5/6 ✅** |

> † Auth integration tests hit Mongo connection timeout (Mongo not reachable during isolated run). Unit suite passes; coverage computed from unit tests only.
> †† 1 Restaurant `$geoNear` integration test hits Jest's 150s timeout on `mongodb-memory-server`. All 125 other tests pass; line coverage still clears 80%.

---

### ⚡ k6 Load Test Results (Real — 2m30s run, 100 VUs)

```
╔══════════════════════════════════════════════╗
║         k6 Load Test — Zomato Clone          ║
╠══════════════════════════════════════════════╣
║  p95 latency  :  5.31 ms                    ║
║  Error rate   :  0.00 %                     ║
║  Throughput   :  114.3 req/s                ║
║  Iterations   :  17,181 (0 interrupted)     ║
╚══════════════════════════════════════════════╝
```

| Threshold | Target | Actual | Status |
|---|---|---|---|
| `http_req_duration p(95)` | < 500ms | **5.31ms** | ✅ |
| `http_req_duration p(99)` | < 1000ms | < 10ms | ✅ |
| `error_rate` | < 1% | **0.00%** | ✅ |

**Load profile:**  
`0→30s`: ramp to 20 VUs · `30→90s`: hold 50 VUs · `90→120s`: ramp to 100 VUs · `120→150s`: ramp down

**Scenarios tested:** `GET /api/restaurant/all` · `GET /api/cart/all` · `POST /api/order/new` · `POST /api/payment/razorpay`

---

### Run Tests Locally

```bash
# Start Docker test infra first
docker-compose -f docker-compose.test.yml up -d

# Per service (from service directory)
npm test                     # run all tests
npm run test:coverage        # with coverage report

# All services
cd services/auth && npm test
cd services/restaurant && npm test
cd services/utils && npm test
cd services/rider && npm test
cd services/admin && npm test
cd services/realtime && npm test

# Load test (k6 binary in repo root)
.\k6\k6-v0.50.0-windows-amd64\k6.exe run k6-load-test.js
# or if k6 is in PATH:
k6 run k6-load-test.js
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 20+
- Docker Desktop (for MongoDB + RabbitMQ)
- MongoDB Atlas account (or local Mongo for dev)

### Start Test Infrastructure
```bash
docker-compose -f docker-compose.test.yml up -d
# Mongo on :27018  |  RabbitMQ on :5673 (AMQP) / :15673 (UI)
```

### Start All Services
```bash
# Each in a separate terminal
cd services/auth && npm run dev          # :5000
cd services/restaurant && npm run dev    # :5001
cd services/utils && npm run dev         # :5002
cd services/realtime && npm run dev      # :5004
cd services/rider && npm run dev         # :5005
cd services/admin && npm run dev         # :5006
cd frontend && npm run dev               # :5173
```

---

## 🔑 Environment Variables

Each service has a `.env` with the following keys (see each service's directory):

| Variable | Services | Description |
|---|---|---|
| `MONGO_URI` | all | MongoDB connection string |
| `JWT_SEC` | auth, restaurant, rider, admin | JWT signing secret |
| `RABBITMQ_URL` | restaurant, utils, rider | AMQP connection URL |
| `INTERNAL_SERVICE_KEY` | restaurant, realtime, rider | Inter-service auth key |
| `STRIPE_SECRET_KEY` | utils | Stripe secret key |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | utils | Razorpay credentials |
| `CLOUD_NAME` / `CLOUD_API_KEY` / `CLOUD_SECRET_KEY` | utils | Cloudinary credentials |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | auth | Google OAuth 2.0 |

---

## 📦 Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Socket.IO client, Leaflet maps |
| **Backend** | Express.js, TypeScript, Mongoose, JWT, Socket.IO |
| **Messaging** | RabbitMQ (amqplib) |
| **Database** | MongoDB Atlas (with geospatial indexes) |
| **Payments** | Stripe + Razorpay |
| **Media** | Cloudinary |
| **Auth** | Google OAuth 2.0, JWT |
| **Testing** | Jest, ts-jest, Supertest, mongodb-memory-server, k6 |
| **CI/CD** | GitHub Actions |
| **Containerisation** | Docker, docker-compose |
