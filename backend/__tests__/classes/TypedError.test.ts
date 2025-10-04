import { describe, expect, it } from "bun:test";
import { ErrorType, TypedError } from "../../classes/TypedError";

describe("TypedError", () => {
  it("should create error with message and type", () => {
    const error = new TypedError({
      message: "Test error",
      type: ErrorType.CONNECTION_ACTION_RUN,
    });

    expect(error.message).toBe("Test error");
    expect(error.type).toBe(ErrorType.CONNECTION_ACTION_RUN);
    expect(error instanceof Error).toBe(true);
  });

  it("should create error with key and value", () => {
    const error = new TypedError({
      message: "Validation error",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      key: "email",
      value: "invalid-email",
    });

    expect(error.key).toBe("email");
    expect(error.value).toBe("invalid-email");
  });

  it("should preserve stack from original Error", () => {
    const originalError = new Error("Original error");
    const typedError = new TypedError({
      message: "Wrapped error",
      type: ErrorType.CONNECTION_SERVER_ERROR,
      originalError,
    });

    expect(typedError.stack).toBe(originalError.stack);
  });

  it("should handle string originalError", () => {
    const typedError = new TypedError({
      message: "Test error",
      type: ErrorType.CONNECTION_SERVER_ERROR,
      originalError: "String error message",
    });

    expect(typedError.stack).toBe("OriginalStringError: String error message");
  });

  it("should handle all error types", () => {
    const errorTypes = [
      ErrorType.SERVER_INITIALIZATION,
      ErrorType.CONFIG_ERROR,
      ErrorType.CONNECTION_SESSION_NOT_FOUND,
      ErrorType.CONNECTION_ACTION_NOT_FOUND,
      ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    ];

    errorTypes.forEach((type) => {
      const error = new TypedError({
        message: "Test",
        type,
      });
      expect(error.type).toBe(type);
    });
  });

  it("should be throwable and catchable", () => {
    expect(() => {
      throw new TypedError({
        message: "Thrown error",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }).toThrow("Thrown error");
  });

  it("should maintain error chain properties", () => {
    try {
      try {
        throw new Error("Inner error");
      } catch (innerError) {
        throw new TypedError({
          message: "Outer error",
          type: ErrorType.CONNECTION_ACTION_RUN,
          originalError: innerError,
        });
      }
    } catch (error) {
      expect(error).toBeInstanceOf(TypedError);
      if (error instanceof TypedError) {
        expect(error.message).toBe("Outer error");
        expect(error.stack).toContain("Inner error");
      }
    }
  });
});
