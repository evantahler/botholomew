import { describe, expect, it } from "bun:test";
import { ExitCode } from "../../classes/ExitCode";

describe("ExitCode", () => {
  it("should have success value of 0", () => {
    expect(ExitCode.success).toBe(0);
  });

  it("should have error value of 1", () => {
    expect(ExitCode.error).toBe(1);
  });

  it("should have two distinct exit code values", () => {
    const exitCodes = Object.keys(ExitCode).filter((key) => isNaN(Number(key)));
    expect(exitCodes).toHaveLength(2);
  });

  it("should be usable in process.exit", () => {
    // Test that ExitCode values are valid numeric exit codes
    expect(typeof ExitCode.success).toBe("number");
    expect(typeof ExitCode.error).toBe("number");
    expect(ExitCode.success).toBeGreaterThanOrEqual(0);
    expect(ExitCode.error).toBeGreaterThanOrEqual(0);
  });
});
