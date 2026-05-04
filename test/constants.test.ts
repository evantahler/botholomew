import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  CONTEXT_DIR,
  DEFAULTS,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  ENV,
  getConfigPath,
  getContextDir,
  getDbPath,
  getMcpxDir,
  getPersistentContextDir,
  getSchedulesDir,
  getSchedulesLockDir,
  getSkillsDir,
  getTasksDir,
  getTasksLockDir,
  getWorkerLogPath,
  getWorkerLogsDir,
  INDEX_DB_FILENAME,
  LOGS_DIR,
  MCPX_DIR,
  PERSISTENT_CONTEXT_DIR,
  SCHEDULES_DIR,
  SKILLS_DIR,
  TASKS_DIR,
} from "../src/constants.ts";

describe("constants", () => {
  test("top-level layout names are stable", () => {
    expect(CONFIG_DIR).toBe("config");
    expect(CONTEXT_DIR).toBe("context");
    expect(PERSISTENT_CONTEXT_DIR).toBe("persistent-context");
    expect(SKILLS_DIR).toBe("skills");
    expect(MCPX_DIR).toBe("mcpx");
    expect(LOGS_DIR).toBe("logs");
    expect(TASKS_DIR).toBe("tasks");
    expect(SCHEDULES_DIR).toBe("schedules");
  });

  test("file name constants are defined", () => {
    expect(INDEX_DB_FILENAME).toBe(".botholomew-index.duckdb");
    expect(CONFIG_FILENAME).toBe("config.json");
  });

  test("embedding constants are defined", () => {
    expect(EMBEDDING_DIMENSION).toBe(384);
    expect(EMBEDDING_MODEL).toBe("Xenova/bge-small-en-v1.5");
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

  test("getConfigPath returns project/config/config.json", () => {
    expect(getConfigPath(projectDir)).toBe(
      join(projectDir, "config", "config.json"),
    );
  });

  test("getDbPath returns project/.botholomew-index.duckdb", () => {
    expect(getDbPath(projectDir)).toBe(
      join(projectDir, ".botholomew-index.duckdb"),
    );
  });

  test("getWorkerLogsDir returns project/logs", () => {
    expect(getWorkerLogsDir(projectDir)).toBe(join(projectDir, "logs"));
  });

  test("getWorkerLogPath returns project/logs/<id>.log", () => {
    expect(getWorkerLogPath(projectDir, "abc123")).toBe(
      join(projectDir, "logs", "abc123.log"),
    );
  });

  test("getMcpxDir returns project/mcpx", () => {
    expect(getMcpxDir(projectDir)).toBe(join(projectDir, "mcpx"));
  });

  test("getSkillsDir returns project/skills", () => {
    expect(getSkillsDir(projectDir)).toBe(join(projectDir, "skills"));
  });

  test("getPersistentContextDir returns project/persistent-context", () => {
    expect(getPersistentContextDir(projectDir)).toBe(
      join(projectDir, "persistent-context"),
    );
  });

  test("getContextDir returns project/context", () => {
    expect(getContextDir(projectDir)).toBe(join(projectDir, "context"));
  });

  test("getTasksDir / getTasksLockDir", () => {
    expect(getTasksDir(projectDir)).toBe(join(projectDir, "tasks"));
    expect(getTasksLockDir(projectDir)).toBe(
      join(projectDir, "tasks", ".locks"),
    );
  });

  test("getSchedulesDir / getSchedulesLockDir", () => {
    expect(getSchedulesDir(projectDir)).toBe(join(projectDir, "schedules"));
    expect(getSchedulesLockDir(projectDir)).toBe(
      join(projectDir, "schedules", ".locks"),
    );
  });
});
