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

## 🧪 Test Suite (Production-Grade)

| Type | Coverage | Tool |
|------|----------|------|
| Unit Tests | JWT middleware, role guards, state machine | Jest + ts-jest |
| Integration Tests | 30+ HTTP endpoints, Cart TTL, Order flow | Supertest + mongodb-memory-server |
| Contract Tests | Payment idempotency, RabbitMQ replay protection | Jest |
| Race Condition Tests | Concurrent rider assignment (atomic `findOneAndUpdate`) | Jest + MongoDB |
| Geospatial Tests | `$near` query within 500m radius, distance ordering | Jest + mongodb-memory-server |
| Load Tests | p50/p95/p99 latency under 100 VUs | k6 |

### Run tests

```bash
# Per service (from service directory)
npm test                     # run all tests
npm run test:coverage        # with coverage report

# All services
cd services/auth && npm test
cd services/restaurant && npm test
cd services/utils && npm test
cd services/rider && npm test

# Load test (requires k6 installed)
k6 run k6-load-test.js
```

## 🚀 Local Setup

### Prerequisites
- Node.js 20+
- Docker Desktop (for RabbitMQ)
- MongoDB Atlas account

### Start RabbitMQ
```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin -e RABBITMQ_DEFAULT_PASS=admin123 \
  rabbitmq:3-management
```

### Start All Services
```bash
# Each in a separate terminal
cd services/auth && npm start          # :5000
cd services/restaurant && npm start    # :5001
cd services/utils && npm start         # :5002
cd services/realtime && npm start      # :5004
cd services/rider && npm start         # :5005
cd services/admin && npm start         # :5006
cd frontend && npm run dev             # :5173
```

## 🔑 Environment Variables

See [Required Credentials Guide](../docs/credentials.md) for all API keys needed.

## 📦 Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Socket.IO client, Leaflet maps
- **Backend**: Express.js, TypeScript, Mongoose, JWT, Socket.IO
- **Messaging**: RabbitMQ (amqplib)
- **Database**: MongoDB Atlas
- **Payments**: Stripe + Razorpay
- **Media**: Cloudinary
- **Auth**: Google OAuth 2.0
- **Testing**: Jest, ts-jest, Supertest, mongodb-memory-server, k6
- **CI/CD**: GitHub Actions
