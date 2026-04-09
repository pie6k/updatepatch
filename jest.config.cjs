/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  coverageDirectory: "coverage",
  coverageReporters: ["json", "text"],
};
