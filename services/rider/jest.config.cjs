/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "<rootDir>/jest-mongodb-environment.cjs",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      useESM: false,
      tsconfig: {
        module: "commonjs",
        esModuleInterop: true,
        types: ["jest", "node"],
      },
    }],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
  coverageThreshold: { global: { lines: 80 } },
  testTimeout: 150000,
};
