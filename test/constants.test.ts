import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  DEFAULTS,
  ENV,
  getConfigPath,
  getMcpxDir,
  getPromptsDir,
  getSchedulesDir,
  getSchedulesLockDir,
  getSkillsDir,
  getTasksDir,
  getTasksLockDir,
  getWorkerLogPath,
  getWorkerLogsDir,
  LOGS_DIR,
  MCPX_DIR,
  PROMPTS_DIR,
  SCHEDULES_DIR,
  SKILLS_DIR,
  TASKS_DIR,
} from "../src/constants.ts";

describe("constants", () => {
  test("top-level layout names are stable", () => {
    expect(CONFIG_DIR).toBe("config");
    expect(PROMPTS_DIR).toBe("prompts");
    expect(SKILLS_DIR).toBe("skills");
    expect(MCPX_DIR).toBe("mcpx");
    expect(LOGS_DIR).toBe("logs");
    expect(TASKS_DIR).toBe("tasks");
    expect(SCHEDULES_DIR).toBe("schedules");
  });

  test("file name constants are defined", () => {
    expect(CONFIG_FILENAME).toBe("config.json");
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

  test("getWorkerLogsDir returns project/logs", () => {
    expect(getWorkerLogsDir(projectDir)).toBe(join(projectDir, "logs"));
  });

  test("getWorkerLogPath returns project/logs/<date>/<id>.log", () => {
    expect(getWorkerLogPath(projectDir, "abc123", "2026-05-04")).toBe(
      join(projectDir, "logs", "2026-05-04", "abc123.log"),
    );
  });

  test("getMcpxDir returns project/mcpx", () => {
    expect(getMcpxDir(projectDir)).toBe(join(projectDir, "mcpx"));
  });

  test("getSkillsDir returns project/skills", () => {
    expect(getSkillsDir(projectDir)).toBe(join(projectDir, "skills"));
  });

  test("getPromptsDir returns project/prompts", () => {
    expect(getPromptsDir(projectDir)).toBe(join(projectDir, "prompts"));
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
