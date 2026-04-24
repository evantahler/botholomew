import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/loader.ts";
import {
  getBotholomewDir,
  getDbPath,
  getMcpxDir,
  getSkillsDir,
} from "../constants.ts";
import { writeCapabilitiesFile } from "../context/capabilities.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
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
  const dotDir = getBotholomewDir(projectDir);
  const mcpxDir = getMcpxDir(projectDir);
  const skillsDir = getSkillsDir(projectDir);

  // Check if already initialized
  const dirExists = await Bun.file(join(dotDir, "soul.md")).exists();
  if (dirExists && !opts.force) {
    throw new Error(
      `.botholomew already initialized in ${projectDir}. Use --force to reinitialize.`,
    );
  }

  // Create directories
  await mkdir(dotDir, { recursive: true });
  await mkdir(mcpxDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  // Write template files
  await Bun.write(join(dotDir, "soul.md"), SOUL_MD);
  await Bun.write(join(dotDir, "beliefs.md"), BELIEFS_MD);
  await Bun.write(join(dotDir, "goals.md"), GOALS_MD);
  await Bun.write(join(dotDir, "capabilities.md"), CAPABILITIES_MD);

  // Write default skills
  await Bun.write(join(skillsDir, "summarize.md"), SUMMARIZE_SKILL);
  await Bun.write(join(skillsDir, "standup.md"), STANDUP_SKILL);
  await Bun.write(join(skillsDir, "capabilities.md"), CAPABILITIES_SKILL);

  // Write config (with placeholder API key)
  await Bun.write(
    join(dotDir, "config.json"),
    `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
  );

  // Write mcpx servers config
  await Bun.write(
    join(mcpxDir, "servers.json"),
    `${JSON.stringify(DEFAULT_MCPX_SERVERS, null, 2)}\n`,
  );

  // Initialize database
  const dbPath = getDbPath(projectDir);
  const conn = await getConnection(dbPath);
  await migrate(conn);
  conn.close();

  // Populate capabilities.md with the real tool inventory. Seeded mcpx
  // servers.json has no entries on first init, so this lists only the
  // built-in tools; running `botholomew capabilities` later after
  // adding MCPX servers picks those up.
  registerAllTools();
  const config = await loadConfig(projectDir);
  const mcpxClient = await createMcpxClient(projectDir);
  try {
    await writeCapabilitiesFile(projectDir, mcpxClient, config);
  } finally {
    await mcpxClient?.close();
  }

  // Update .gitignore
  await updateGitignore(projectDir);

  logger.success("Initialized Botholomew project");
  logger.dim(`  Directory: ${dotDir}`);
  logger.dim(`  Database: ${dbPath}`);
  logger.dim("");
  logger.dim("Next steps:");
  logger.dim("  1. Set ANTHROPIC_API_KEY or add it to .botholomew/config.json");
  logger.dim("  2. Run 'botholomew task add' to create your first task");
  logger.dim(
    "  3. Run 'botholomew worker start --persist' to start a background worker",
  );
}

async function updateGitignore(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  const file = Bun.file(gitignorePath);

  let content = "";
  if (await file.exists()) {
    content = await file.text();
  }

  const entry = ".botholomew/";
  if (content.includes(entry)) return;

  const section = `\n# Botholomew (auto-generated)\n${entry}\n`;
  await Bun.write(gitignorePath, `${content.trimEnd()}\n${section}`);
}
