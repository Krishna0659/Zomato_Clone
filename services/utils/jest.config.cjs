/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
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
  testTimeout: 30000,
};
