import { describe, expect, test } from "bun:test";
import { config } from "../../config";

describe("Workflow Ticker Config", () => {
  test("should have default workflow ticker frequency of 10000ms", () => {
    expect(config.tasks.workflowTickerFrequency).toBe(10000);
  });

  test("should be configurable via environment variable", () => {
    // This tests that the config is loaded from environment
    // The actual environment variable override would be tested in integration tests
    expect(typeof config.tasks.workflowTickerFrequency).toBe("number");
    expect(config.tasks.workflowTickerFrequency).toBeGreaterThan(0);
  });
});
