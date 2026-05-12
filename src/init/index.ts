import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/loader.ts";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  getConfigPath,
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
import { assertCompatibleFilesystem } from "../fs/compat.ts";
import { createMcpxClient, resolveMcpxDir } from "../mcpx/client.ts";
import { openMembot, resolveMembotDir } from "../mem/client.ts";
import { writeCapabilitiesFile } from "../prompts/capabilities.ts";
import { registerAllTools } from "../tools/registry.ts";
import { logger } from "../utils/logger.ts";
import {
  BELIEFS_MD,
  CAPABILITIES_MD,
  CAPABILITIES_SKILL,
  DEFAULT_CONFIG,
  DEFAULT_MCPX_SERVERS,
  GOALS_MD,
  STANDUP_SKILL,
  SUMMARIZE_SKILL,
} from "./templates.ts";

export interface InitOptions {
  force?: boolean;
  /** Override the default `membot_scope` written into config/config.json. */
  membotScope?: "global" | "project";
  /** Override the default `mcpx_scope` written into config/config.json. */
  mcpxScope?: "global" | "project";
}

export async function initProject(
  projectDir: string,
  opts: InitOptions = {},
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
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
  await mkdir(getSchedulesDir(projectDir), { recursive: true });
  await mkdir(getSchedulesLockDir(projectDir), { recursive: true });
  await mkdir(getWorkersDir(projectDir), { recursive: true });
  await mkdir(getThreadsDir(projectDir), { recursive: true });
  await mkdir(join(projectDir, LOGS_DIR), { recursive: true });

  // Persistent-context template files
  const pcDir = getPromptsDir(projectDir);
  await Bun.write(join(pcDir, "goals.md"), GOALS_MD);
  await Bun.write(join(pcDir, "beliefs.md"), BELIEFS_MD);
  await Bun.write(join(pcDir, "capabilities.md"), CAPABILITIES_MD);

  // Default skills
  const skillsDir = getSkillsDir(projectDir);
  await Bun.write(join(skillsDir, "summarize.md"), SUMMARIZE_SKILL);
  await Bun.write(join(skillsDir, "standup.md"), STANDUP_SKILL);
  await Bun.write(join(skillsDir, "capabilities.md"), CAPABILITIES_SKILL);

  // Config — apply scope overrides from caller (CLI flags / tests) on top of
  // the seeded defaults so tests and `botholomew init --membot-scope=project`
  // can pick a per-project layout up front.
  const initialConfig = {
    ...DEFAULT_CONFIG,
    ...(opts.membotScope ? { membot_scope: opts.membotScope } : {}),
    ...(opts.mcpxScope ? { mcpx_scope: opts.mcpxScope } : {}),
  };
  await Bun.write(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`);
  const config = await loadConfig(projectDir);

  // mcpx servers config — only seed a project-local servers.json when the
  // project is opting out of the shared `~/.mcpx`. The empty `mcpx/` directory
  // is still created above so flipping `mcpx_scope` later is a one-line edit.
  if (config.mcpx_scope === "project") {
    await Bun.write(
      join(getMcpxDir(projectDir), MCPX_SERVERS_FILENAME),
      `${JSON.stringify(DEFAULT_MCPX_SERVERS, null, 2)}\n`,
    );
  }

  // Initialize the membot knowledge store. Opening + closing the client
  // triggers membot's first-run migration. When `membot_scope` is "global"
  // (the default) we point at `~/.membot` so the shared store is ready;
  // when "project" we seed `<projectDir>/index.duckdb`.
  const mem = openMembot(resolveMembotDir(projectDir, config));
  await mem.connect();
  await mem.close();

  // Populate capabilities.md with the real tool inventory.
  registerAllTools();
  const mcpxClient = await createMcpxClient(resolveMcpxDir(projectDir, config));
  try {
    await writeCapabilitiesFile(projectDir, mcpxClient, config);
  } finally {
    await mcpxClient?.close();
  }

  const membotScopeDesc =
    config.membot_scope === "project"
      ? `${projectDir}/index.duckdb (project-local)`
      : `~/.membot (shared across projects — set membot_scope to "project" in ${CONFIG_DIR}/${CONFIG_FILENAME} to isolate)`;
  const mcpxScopeDesc =
    config.mcpx_scope === "project"
      ? `${projectDir}/mcpx/ (project-local)`
      : `~/.mcpx (shared across projects — set mcpx_scope to "project" in ${CONFIG_DIR}/${CONFIG_FILENAME} to isolate)`;
  logger.success("Initialized Botholomew project");
  logger.dim(`  Project root:  ${projectDir}`);
  logger.dim(`  Config:        ${CONFIG_DIR}/${CONFIG_FILENAME}`);
  logger.dim(`  Knowledge:     ${membotScopeDesc}`);
  logger.dim(`  MCPX:          ${mcpxScopeDesc}`);
  logger.dim("");
  logger.dim("Layout:");
  logger.dim(`  ${CONFIG_DIR}/         settings`);
  logger.dim(
    `  prompts/         goals, beliefs, capabilities (and any you add)`,
  );
  logger.dim(`  ${TASKS_DIR}/          one markdown file per task`);
  logger.dim(`    ${LOCKS_SUBDIR}/        worker claim lockfiles`);
  logger.dim(`  ${SCHEDULES_DIR}/      one markdown file per schedule`);
  logger.dim(`  threads/         one CSV per conversation, by UTC date`);
  logger.dim(`  workers/         one JSON pidfile per worker (heartbeats)`);
  logger.dim(`  skills/, mcpx/, logs/`);
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
