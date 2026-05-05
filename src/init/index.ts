import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/loader.ts";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  CONTEXT_DIR,
  getConfigPath,
  getDbPath,
  getMcpxDir,
  getPromptsDir,
  getSchedulesDir,
  getSchedulesLockDir,
  getSkillsDir,
  getTasksDir,
  getTasksLockDir,
  getThreadsDir,
  getWorkersDir,
  LOCKS_SUBDIR,
  LOGS_DIR,
  MCPX_SERVERS_FILENAME,
  SCHEDULES_DIR,
  TASKS_DIR,
} from "../constants.ts";
import { writeCapabilitiesFile } from "../context/capabilities.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import { assertCompatibleFilesystem } from "../fs/compat.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { registerAllTools } from "../tools/registry.ts";
import { logger } from "../utils/logger.ts";
import {
  BELIEFS_MD,
  CAPABILITIES_MD,
  CAPABILITIES_SKILL,
  DEFAULT_CONFIG,
  DEFAULT_MCPX_SERVERS,
  GOALS_MD,
  SOUL_MD,
  STANDUP_SKILL,
  SUMMARIZE_SKILL,
} from "./templates.ts";

export async function initProject(
  projectDir: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  // Refuse to operate inside iCloud/Dropbox/etc unless --force is passed.
  // Sync overlays break atomic rename / O_EXCL semantics that tasks and
  // schedules depend on.
  assertCompatibleFilesystem(projectDir, !!opts.force);

  const configPath = getConfigPath(projectDir);
  const alreadyInitialized = await Bun.file(configPath).exists();
  if (alreadyInitialized && !opts.force) {
    throw new Error(
      `Botholomew project already initialized in ${projectDir} (found ${CONFIG_DIR}/${CONFIG_FILENAME}). Use --force to reinitialize.`,
    );
  }

  // Top-level directories
  await mkdir(join(projectDir, CONFIG_DIR), { recursive: true });
  await mkdir(getPromptsDir(projectDir), { recursive: true });
  await mkdir(getSkillsDir(projectDir), { recursive: true });
  await mkdir(getMcpxDir(projectDir), { recursive: true });
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
  await mkdir(getSchedulesDir(projectDir), { recursive: true });
  await mkdir(getSchedulesLockDir(projectDir), { recursive: true });
  await mkdir(getWorkersDir(projectDir), { recursive: true });
  await mkdir(getThreadsDir(projectDir), { recursive: true });
  await mkdir(join(projectDir, LOGS_DIR), { recursive: true });

  // Persistent-context template files
  const pcDir = getPromptsDir(projectDir);
  await Bun.write(join(pcDir, "soul.md"), SOUL_MD);
  await Bun.write(join(pcDir, "beliefs.md"), BELIEFS_MD);
  await Bun.write(join(pcDir, "goals.md"), GOALS_MD);
  await Bun.write(join(pcDir, "capabilities.md"), CAPABILITIES_MD);

  // Default skills
  const skillsDir = getSkillsDir(projectDir);
  await Bun.write(join(skillsDir, "summarize.md"), SUMMARIZE_SKILL);
  await Bun.write(join(skillsDir, "standup.md"), STANDUP_SKILL);
  await Bun.write(join(skillsDir, "capabilities.md"), CAPABILITIES_SKILL);

  // Config
  await Bun.write(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);

  // mcpx servers config
  await Bun.write(
    join(getMcpxDir(projectDir), MCPX_SERVERS_FILENAME),
    `${JSON.stringify(DEFAULT_MCPX_SERVERS, null, 2)}\n`,
  );

  // Initialize the index database (search index sidecar; rebuildable).
  const dbPath = getDbPath(projectDir);
  const conn = await getConnection(dbPath);
  await migrate(conn);
  conn.close();

  // Populate capabilities.md with the real tool inventory.
  registerAllTools();
  const config = await loadConfig(projectDir);
  const mcpxClient = await createMcpxClient(projectDir);
  try {
    await writeCapabilitiesFile(projectDir, mcpxClient, config);
  } finally {
    await mcpxClient?.close();
  }

  logger.success("Initialized Botholomew project");
  logger.dim(`  Project root: ${projectDir}`);
  logger.dim(`  Config:       ${CONFIG_DIR}/${CONFIG_FILENAME}`);
  logger.dim(`  Index DB:     ${dbPath}`);
  logger.dim("");
  logger.dim("Layout:");
  logger.dim(`  ${CONFIG_DIR}/         settings`);
  logger.dim(`  prompts/   soul, beliefs, goals, capabilities`);
  logger.dim(`  ${CONTEXT_DIR}/        agent-writable knowledge tree`);
  logger.dim(`  ${TASKS_DIR}/          one markdown file per task`);
  logger.dim(`    ${LOCKS_SUBDIR}/        worker claim lockfiles`);
  logger.dim(`  ${SCHEDULES_DIR}/      one markdown file per schedule`);
  logger.dim(`  threads/         one CSV per conversation, by UTC date`);
  logger.dim(`  workers/         one JSON pidfile per worker (heartbeats)`);
  logger.dim(`  skills/, mcpx/, models/, logs/`);
  logger.dim("");
  logger.dim("Next steps:");
  logger.dim(
    `  1. Set ANTHROPIC_API_KEY or add it to ${CONFIG_DIR}/${CONFIG_FILENAME}`,
  );
  logger.dim("  2. Run 'botholomew task add' to create your first task");
  logger.dim(
    "  3. Run 'botholomew worker start --persist' to start a background worker",
  );
}
