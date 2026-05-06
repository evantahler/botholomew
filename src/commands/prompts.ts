import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { getPromptsDir } from "../constants.ts";
import { atomicWrite } from "../fs/atomic.ts";
import {
  PromptValidationError,
  parsePromptFile,
  serializePromptFile,
} from "../utils/frontmatter.ts";
import { logger } from "../utils/logger.ts";

const VALID_NAME = /^[a-zA-Z0-9._-]+$/;

export function registerPromptsCommand(program: Command) {
  const prompts = program
    .command("prompts")
    .description(
      "Manage prompt files (always-on or contextual notes for the agent)",
    );

  prompts
    .command("list")
    .description("List prompts under prompts/")
    .option("-l, --limit <n>", "max number of prompts", Number.parseInt)
    .option("-o, --offset <n>", "skip first N prompts", Number.parseInt)
    .action(async (opts: { limit?: number; offset?: number }) => {
      const dir = program.opts().dir as string;
      const promptsDir = getPromptsDir(dir);
      const files = await listPromptFiles(promptsDir);

      if (files.length === 0) {
        logger.dim("No prompt files found.");
        return;
      }

      const start = opts.offset ?? 0;
      const end = opts.limit ? start + opts.limit : undefined;
      const page = files.slice(start, end);

      const header = `${ansis.bold("Name".padEnd(20))} ${ansis.bold("Title".padEnd(28))} ${ansis.bold("Loading".padEnd(12))} ${ansis.bold("Editable".padEnd(10))} ${ansis.bold("Size".padEnd(8))} ${ansis.bold("Status")}`;
      console.log(header);
      console.log("-".repeat(header.length));

      for (const filename of page) {
        const filePath = join(promptsDir, filename);
        const name = filename.replace(/\.md$/, "");
        const [raw, st] = await Promise.all([
          Bun.file(filePath).text(),
          stat(filePath),
        ]);
        try {
          const { meta } = parsePromptFile(filePath, raw);
          console.log(
            [
              name.padEnd(20),
              meta.title.slice(0, 27).padEnd(28),
              meta.loading.padEnd(12),
              (meta["agent-modification"] ? "yes" : "no").padEnd(10),
              `${st.size}`.padEnd(8),
              ansis.green("ok"),
            ].join(" "),
          );
        } catch (err) {
          const reason =
            err instanceof PromptValidationError
              ? err.reason
              : err instanceof Error
                ? err.message
                : String(err);
          console.log(
            [
              name.padEnd(20),
              ansis.dim("—".padEnd(28)),
              ansis.dim("—".padEnd(12)),
              ansis.dim("—".padEnd(10)),
              `${st.size}`.padEnd(8),
              ansis.red(`invalid: ${reason}`),
            ].join(" "),
          );
        }
      }

      const footer =
        page.length === files.length
          ? `${files.length} prompt(s)`
          : `showing ${page.length} of ${files.length} prompt(s)`;
      console.log(`\n${ansis.dim(footer)}`);
    });

  prompts
    .command("show <name>")
    .description("Print the raw contents of a prompt file")
    .action(async (name: string) => {
      const dir = program.opts().dir as string;
      const filePath = resolvePromptPath(dir, name);
      if (!filePath) {
        logger.error(`Invalid prompt name: ${name}`);
        process.exit(1);
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        logger.error(`Prompt not found: ${relative(dir, filePath)}`);
        process.exit(1);
      }
      process.stdout.write(await file.text());
    });

  prompts
    .command("create <name>")
    .description("Create a new prompt file")
    .option("--title <title>", "human-readable title (defaults to <name>)")
    .option(
      "--loading <mode>",
      "'always' or 'contextual' (default: always)",
      "always",
    )
    .option(
      "--no-agent-modification",
      "make this prompt read-only to the agent",
    )
    .option("--from-file <path>", "read body from a file (use '-' for stdin)")
    .option("--force", "overwrite if a prompt with this name exists")
    .action(
      async (
        name: string,
        opts: {
          title?: string;
          loading: string;
          agentModification: boolean;
          fromFile?: string;
          force?: boolean;
        },
      ) => {
        const dir = program.opts().dir as string;
        if (!VALID_NAME.test(name) || name.includes("..")) {
          logger.error(`Invalid prompt name: ${name}`);
          logger.dim("Use [a-zA-Z0-9._-] only — no slashes, no '..'.");
          process.exit(1);
        }
        if (opts.loading !== "always" && opts.loading !== "contextual") {
          logger.error(`--loading must be 'always' or 'contextual'`);
          process.exit(1);
        }

        const promptsDir = getPromptsDir(dir);
        const filePath = join(promptsDir, `${name}.md`);
        if (!opts.force && (await Bun.file(filePath).exists())) {
          logger.error(`Prompt already exists: ${relative(dir, filePath)}`);
          logger.dim("Use --force to overwrite.");
          process.exit(1);
        }

        let body: string;
        if (opts.fromFile === "-") {
          body = await readStdin();
        } else if (opts.fromFile) {
          body = await Bun.file(opts.fromFile).text();
        } else {
          body = `# ${opts.title ?? name}\n`;
        }

        const meta = {
          title: opts.title ?? name,
          loading: opts.loading as "always" | "contextual",
          "agent-modification": opts.agentModification,
        };
        const serialized = serializePromptFile(meta, body);

        try {
          parsePromptFile(filePath, serialized);
        } catch (err) {
          logger.error(
            err instanceof PromptValidationError
              ? err.message
              : `Generated content failed validation: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }

        await mkdir(promptsDir, { recursive: true });
        await atomicWrite(filePath, serialized);
        logger.success(`Created prompt: ${relative(dir, filePath)}`);
      },
    );

  prompts
    .command("edit <name>")
    .description("Open a prompt in $EDITOR; refuse to keep invalid output")
    .action(async (name: string) => {
      const dir = program.opts().dir as string;
      const filePath = resolvePromptPath(dir, name);
      if (!filePath) {
        logger.error(`Invalid prompt name: ${name}`);
        process.exit(1);
      }
      if (!(await Bun.file(filePath).exists())) {
        logger.error(`Prompt not found: ${relative(dir, filePath)}`);
        process.exit(1);
      }

      const editor = process.env.EDITOR || process.env.VISUAL || "nano";
      await new Promise<void>((resolve, reject) => {
        const child = spawn(editor, [filePath], { stdio: "inherit" });
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${editor} exited with code ${code}`));
        });
        child.on("error", reject);
      });

      const raw = await Bun.file(filePath).text();
      try {
        parsePromptFile(filePath, raw);
        logger.success(`Saved: ${relative(dir, filePath)}`);
      } catch (err) {
        const reason =
          err instanceof PromptValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        const quarantine = `${filePath}.tmp.invalid`;
        await atomicWrite(quarantine, raw);
        logger.error(`Validation failed: ${reason}`);
        logger.dim(
          `Wrote your edits to ${relative(dir, quarantine)} so you can recover them. The original file is unchanged.`,
        );
        process.exit(1);
      }
    });

  prompts
    .command("delete <name>")
    .description("Delete a prompt file")
    .option("--force", "delete even if marked agent-modification: false")
    .action(async (name: string, opts: { force?: boolean }) => {
      const dir = program.opts().dir as string;
      const filePath = resolvePromptPath(dir, name);
      if (!filePath) {
        logger.error(`Invalid prompt name: ${name}`);
        process.exit(1);
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        logger.error(`Prompt not found: ${relative(dir, filePath)}`);
        process.exit(1);
      }

      if (!opts.force) {
        const raw = await file.text();
        try {
          const { meta } = parsePromptFile(filePath, raw);
          if (!meta["agent-modification"]) {
            logger.error(
              `${relative(dir, filePath)} is marked agent-modification: false`,
            );
            logger.dim("Use --force to delete anyway.");
            process.exit(1);
          }
        } catch {
          // Malformed — let the user delete it; that's why they're here.
        }
      }

      await unlink(filePath);
      logger.success(`Deleted prompt: ${relative(dir, filePath)}`);
    });

  prompts
    .command("validate")
    .description("Validate every prompt file under prompts/")
    .action(async () => {
      const dir = program.opts().dir as string;
      const promptsDir = getPromptsDir(dir);
      const files = await listPromptFiles(promptsDir);

      if (files.length === 0) {
        logger.dim("No prompt files found.");
        return;
      }

      let hasErrors = false;
      for (const filename of files) {
        const filePath = join(promptsDir, filename);
        const raw = await Bun.file(filePath).text();
        try {
          parsePromptFile(filePath, raw);
          logger.success(
            `${ansis.bold(filename.padEnd(24))} ${ansis.green("ok")}`,
          );
        } catch (err) {
          hasErrors = true;
          const reason =
            err instanceof PromptValidationError
              ? err.reason
              : err instanceof Error
                ? err.message
                : String(err);
          logger.error(
            `${ansis.bold(filename.padEnd(24))} ${ansis.red(reason)}`,
          );
        }
      }

      if (hasErrors) process.exit(1);
    });
}

function resolvePromptPath(projectDir: string, name: string): string | null {
  if (!VALID_NAME.test(name) || name.includes("..")) return null;
  return join(getPromptsDir(projectDir), `${name}.md`);
}

async function listPromptFiles(promptsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(promptsDir);
    return entries.filter((f) => f.endsWith(".md")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
