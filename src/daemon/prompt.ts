import { readdir } from "fs/promises";
import { join } from "path";
import { getBotholomewDir } from "../constants.ts";
import { parseContextFile } from "../utils/frontmatter.ts";

const pkg = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

export async function buildSystemPrompt(projectDir: string): Promise<string> {
  const dotDir = getBotholomewDir(projectDir);
  const parts: string[] = [];

  // Meta information
  parts.push(`# Botholomew v${pkg.version}`);
  parts.push(`Current time: ${new Date().toISOString()}`);
  parts.push(`Project directory: ${projectDir}`);
  parts.push(`OS: ${process.platform} ${process.arch}`);
  parts.push(
    `User: ${process.env.USER || process.env.USERNAME || "unknown"}`,
  );
  parts.push("");

  // Load all "always" context files
  try {
    const files = await readdir(dotDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    for (const filename of mdFiles) {
      const filePath = join(dotDir, filename);
      const raw = await Bun.file(filePath).text();
      const { meta, content } = parseContextFile(raw);

      if (meta.loading === "always") {
        parts.push(`## ${filename}`);
        parts.push(content);
        parts.push("");
      }
    }
  } catch {
    // .botholomew dir might not have md files yet
  }

  // Instructions
  parts.push("## Instructions");
  parts.push(
    "You are the Botholomew daemon. You wake up periodically to work through tasks.",
  );
  parts.push(
    "When given a task, use the available tools to complete it.",
  );
  parts.push(
    "Always call complete_task, fail_task, or wait_task when you are done.",
  );
  parts.push("If you need to create subtasks, use create_task.");
  parts.push("");

  return parts.join("\n");
}
