import { mock } from "bun:test";

// Suppress @actions/core logs during tests
mock.module("@actions/core", () => ({
  debug: () => {},
  warning: () => {},
  info: () => {},
  error: () => {},
  setOutput: () => {},
  setFailed: () => {},
}));
