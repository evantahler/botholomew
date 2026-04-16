import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  BOTHOLOMEW_DIR,
  CONFIG_FILENAME,
  DB_FILENAME,
  DEFAULTS,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  ENV,
  getBotholomewDir,
  getConfigPath,
  getDbPath,
  getLogPath,
  getMcpxDir,
  getPidPath,
  LOG_FILENAME,
  MCPX_DIR,
  PID_FILENAME,
} from "../src/constants.ts";

describe("constants", () => {
  test("BOTHOLOMEW_DIR is .botholomew", () => {
    expect(BOTHOLOMEW_DIR).toBe(".botholomew");
  });

  test("file name constants are defined", () => {
    expect(DB_FILENAME).toBe("data.sqlite");
    expect(PID_FILENAME).toBe("daemon.pid");
    expect(LOG_FILENAME).toBe("daemon.log");
    expect(CONFIG_FILENAME).toBe("config.json");
    expect(MCPX_DIR).toBe("mcpx");
  });

  test("embedding constants are defined", () => {
    expect(EMBEDDING_DIMENSION).toBe(1536);
    expect(EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });

  test("environment variable keys are defined", () => {
    expect(ENV.NO_UPDATE_CHECK).toBe("BOTHOLOMEW_NO_UPDATE_CHECK");
  });

  test("default values are sensible", () => {
    expect(DEFAULTS.UPDATE_CHECK_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(DEFAULTS.UPDATE_CHECK_TIMEOUT_MS).toBe(5000);
  });
});

describe("path helpers", () => {
  const projectDir = "/home/user/my-project";

  test("getBotholomewDir returns project/.botholomew", () => {
    expect(getBotholomewDir(projectDir)).toBe(join(projectDir, ".botholomew"));
  });

  test("getDbPath returns project/.botholomew/data.sqlite", () => {
    expect(getDbPath(projectDir)).toBe(
      join(projectDir, ".botholomew", "data.sqlite"),
    );
  });

  test("getPidPath returns project/.botholomew/daemon.pid", () => {
    expect(getPidPath(projectDir)).toBe(
      join(projectDir, ".botholomew", "daemon.pid"),
    );
  });

  test("getLogPath returns project/.botholomew/daemon.log", () => {
    expect(getLogPath(projectDir)).toBe(
      join(projectDir, ".botholomew", "daemon.log"),
    );
  });

  test("getConfigPath returns project/.botholomew/config.json", () => {
    expect(getConfigPath(projectDir)).toBe(
      join(projectDir, ".botholomew", "config.json"),
    );
  });

  test("getMcpxDir returns project/.botholomew/mcpx", () => {
    expect(getMcpxDir(projectDir)).toBe(
      join(projectDir, ".botholomew", "mcpx"),
    );
  });

  test("path helpers work with trailing slash", () => {
    expect(getBotholomewDir("/tmp/proj/")).toBe(
      join("/tmp/proj/", ".botholomew"),
    );
  });

  test("path helpers work with relative paths", () => {
    const result = getBotholomewDir("relative/path");
    expect(result).toBe(join("relative/path", ".botholomew"));
  });
});
