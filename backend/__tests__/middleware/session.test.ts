import { describe, expect, it } from "bun:test";
import { Connection } from "../../classes/Connection";
import { SessionMiddleware } from "../../middleware/session";

describe("SessionMiddleware", () => {
  it("should pass when session exists with userId", async () => {
    const connection = {
      session: {
        data: {
          userId: 123,
        },
      },
    } as unknown as Connection;

    await expect(
      SessionMiddleware.runBefore?.({}, connection),
    ).resolves.toBeUndefined();
  });

  it("should throw when session is missing", async () => {
    const connection = {
      session: undefined,
    } as Connection;

    await expect(SessionMiddleware.runBefore?.({}, connection)).rejects.toThrow(
      "Session not found",
    );
  });

  it("should throw when session exists but userId is missing", async () => {
    const connection = {
      session: {
        data: {},
      },
    } as Connection;

    await expect(SessionMiddleware.runBefore?.({}, connection)).rejects.toThrow(
      "Session not found",
    );
  });

  it("should throw when userId is null", async () => {
    const connection = {
      session: {
        data: {
          userId: null,
        },
      },
    } as unknown as Connection;

    await expect(SessionMiddleware.runBefore?.({}, connection)).rejects.toThrow(
      "Session not found",
    );
  });

  it("should not have runAfter method", () => {
    expect(SessionMiddleware.runAfter).toBeUndefined();
  });
});
