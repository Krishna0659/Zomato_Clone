// Propagate MONGO_TEST_URI into jest worker processes
process.env.MONGO_TEST_URI =
  process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27018/rider_test";
