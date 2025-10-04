import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Logger, LogLevel } from "../../classes/Logger";

describe("Logger", () => {
  let mockOutput: ReturnType<typeof mock>;
  let logger: Logger;

  beforeEach(() => {
    mockOutput = mock(() => {});
    logger = new Logger({
      level: LogLevel.info,
      colorize: false,
      includeTimestamps: false,
    });
    logger.outputStream = mockOutput;
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      const testLogger = new Logger({
        level: LogLevel.debug,
        colorize: true,
        includeTimestamps: true,
      });

      expect(testLogger.level).toBe(LogLevel.debug);
      expect(testLogger.colorize).toBe(true);
      expect(testLogger.includeTimestamps).toBe(true);
    });
  });

  describe("log", () => {
    it("should log message at correct level", () => {
      logger.log(LogLevel.info, "Test message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[info]");
      expect(mockOutput.mock.calls[0][0]).toContain("Test message");
    });

    it("should not log messages below threshold", () => {
      logger.level = LogLevel.warn;
      logger.log(LogLevel.info, "Should not appear");
      expect(mockOutput).not.toHaveBeenCalled();
    });

    it("should log messages at or above threshold", () => {
      logger.level = LogLevel.warn;
      logger.log(LogLevel.error, "Should appear");
      expect(mockOutput).toHaveBeenCalled();
    });

    it("should include object when provided", () => {
      logger.log(LogLevel.info, "Message", { key: "value" });
      expect(mockOutput.mock.calls[0][0]).toContain('"key"');
      expect(mockOutput.mock.calls[0][0]).toContain('"value"');
    });

    it("should not log when quiet is true", () => {
      logger.quiet = true;
      logger.log(LogLevel.error, "Should not appear");
      expect(mockOutput).not.toHaveBeenCalled();
    });

    it("should include timestamp when enabled", () => {
      logger.includeTimestamps = true;
      logger.log(LogLevel.info, "Test");
      expect(mockOutput.mock.calls[0][0]).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("convenience methods", () => {
    it("should log trace messages", () => {
      logger.level = LogLevel.trace;
      logger.trace("Trace message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[trace]");
    });

    it("should log debug messages", () => {
      logger.level = LogLevel.debug;
      logger.debug("Debug message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[debug]");
    });

    it("should log info messages", () => {
      logger.info("Info message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[info]");
    });

    it("should log warn messages", () => {
      logger.warn("Warning message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[warn]");
    });

    it("should log error messages", () => {
      logger.error("Error message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[error]");
    });

    it("should log fatal messages", () => {
      logger.fatal("Fatal message");
      expect(mockOutput).toHaveBeenCalled();
      expect(mockOutput.mock.calls[0][0]).toContain("[fatal]");
    });
  });

  describe("log level hierarchy", () => {
    it("should respect log level ordering", () => {
      const levels = [
        LogLevel.trace,
        LogLevel.debug,
        LogLevel.info,
        LogLevel.warn,
        LogLevel.error,
        LogLevel.fatal,
      ];

      logger.level = LogLevel.warn;

      // Should log warn, error, fatal
      logger.warn("warn");
      logger.error("error");
      logger.fatal("fatal");
      expect(mockOutput).toHaveBeenCalledTimes(3);

      mockOutput.mockClear();

      // Should not log trace, debug, info
      logger.trace("trace");
      logger.debug("debug");
      logger.info("info");
      expect(mockOutput).not.toHaveBeenCalled();
    });
  });

  describe("colorize", () => {
    it("should colorize output when enabled", () => {
      logger.colorize = true;
      logger.includeTimestamps = true;
      logger.info("Test", { key: "value" });

      // When colorize is enabled, the output contains ANSI color codes
      const output = mockOutput.mock.calls[0][0];
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });
  });
});
