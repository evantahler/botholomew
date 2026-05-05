import { stat } from "node:fs/promises";
import { join } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import { CONTEXT_DIR, getDbPath } from "../constants.ts";
import { fetchUrl } from "../context/fetcher.ts";
import { reindexContext } from "../context/reindex.ts";
import {
  buildTree,
  fileExists,
  listContextDir,
  type TreeNode,
  writeContextFile,
} from "../context/store.ts";
import { withDb } from "../db/connection.ts";
import { indexStats } from "../db/embeddings.ts";
import { migrate } from "../db/schema.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { logger } from "../utils/logger.ts";

export function registerContextCommand(program: Command) {
  const context = program
    .command("context")
    .description(
      "Inspect and manage the on-disk context/ tree (the agent's knowledge store)",
    );

  // ---- import --------------------------------------------------------------
  context
    .command("import <url>")
    .description(
      "Fetch a URL via MCP (Google Docs, Firecrawl, GitHub, etc.) and write the result into context/.",
    )
    .option(
      "-p, --path <path>",
      "destination path under context/ (default: derived from the URL)",
    )
    .option(
      "--prompt <text>",
      "extra guidance passed to the LLM-driven fetcher (e.g. 'export as markdown')",
    )
    .option("--overwrite", "replace an existing file at the destination path")
    .action(async (url: string, opts) => {
      const dir = program.opts().dir;
      const config = await loadConfig(dir);
      const mcpxClient = await createMcpxClient(dir);
      const spinner = createSpinner(`fetching ${url}`).start();
      try {
        const fetched = await fetchUrl(url, config, mcpxClient, opts.prompt);
        spinner.update({ text: "writing to context/" });
        const dest = opts.path ?? deriveContextPath(url, fetched.source);
        await writeContextFile(dir, dest, fetched.content, {
          onConflict: opts.overwrite ? "overwrite" : "error",
        });
        spinner.success({
          text: `imported ${fetched.content.length} bytes → ${ansis.bold(`context/${dest}`)} (source: ${fetched.source ?? "http"})`,
        });
      } catch (err) {
        spinner.error({
          text: `import failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        process.exit(1);
      } finally {
        await mcpxClient?.close();
      }
    });

  // ---- reindex -------------------------------------------------------------
  context
    .command("reindex")
    .description(
      "Walk context/ and reconcile the search index: embed new files, re-embed changed ones, drop rows for removed ones.",
    )
    .action(async () => {
      const dir = program.opts().dir;
      const config = await loadConfig(dir);
      const dbPath = getDbPath(dir);
      // The migrate() call ensures the index DB is initialized, including
      // the context_index table from migration 19, before we try to write.
      await withDb(dbPath, migrate);
      const spinner = createSpinner("reindexing").start();
      const summary = await reindexContext(dir, config, dbPath, {
        onProgress: (msg) => spinner.update({ text: msg }),
      });
      const parts = [
        `${summary.added} added`,
        `${summary.updated} updated`,
        `${summary.unchanged} unchanged`,
        `${summary.removed} removed`,
        `${summary.chunksWritten} chunks written`,
      ];
      spinner.success({ text: parts.join(", ") });
    });

  // ---- tree ---------------------------------------------------------------
  context
    .command("tree [path]")
    .description("Render the context/ tree (or a subdirectory).")
    .option(
      "-d, --max-depth <n>",
      "max directory depth to render",
      Number.parseInt,
      10,
    )
    .action(async (path: string | undefined, opts) => {
      const dir = program.opts().dir;
      const node = await buildTree(dir, path ?? "", opts.maxDepth);
      console.log(renderTreeAnsi(node));
    });

  // ---- stats --------------------------------------------------------------
  context
    .command("stats")
    .description(
      "Counts and sizes for files under context/ and rows in the search index.",
    )
    .action(async () => {
      const dir = program.opts().dir;
      const dbPath = getDbPath(dir);
      const exists = await fileExists(dir, "");
      if (!exists) {
        logger.dim(`context/ does not exist under ${dir}`);
        return;
      }
      const entries = await listContextDir(dir, "", { recursive: true });
      let files = 0;
      let textual = 0;
      let bytes = 0;
      for (const e of entries) {
        if (e.is_directory) continue;
        files++;
        if (e.is_textual) textual++;
        try {
          const st = await stat(join(dir, CONTEXT_DIR, e.path));
          bytes += st.size;
        } catch {
          // file vanished mid-walk — skip
        }
      }
      const idx = await withDb(dbPath, async (conn) => {
        await migrate(conn);
        return indexStats(conn);
      });
      const rows = [
        ["files", String(files)],
        ["textual", String(textual)],
        ["binary", String(files - textual)],
        ["bytes on disk", formatBytes(bytes)],
        ["indexed paths", String(idx.paths)],
        ["index chunks", String(idx.chunks)],
        ["embedded chunks", String(idx.embedded)],
      ];
      const labelWidth = Math.max(...rows.map((r) => r[0]?.length ?? 0));
      for (const [label, value] of rows) {
        console.log(
          `  ${ansis.dim((label ?? "").padEnd(labelWidth))}  ${value}`,
        );
      }
    });
}

/**
 * Pick a sensible default destination under context/ when the user didn't
 * supply --path. Strategy:
 *  - "<source>/<slugified-url>.md" for MCP-served fetches (e.g. google-docs/...)
 *  - "url/<slugified-url>.md" for raw HTTP fallbacks
 */
function deriveContextPath(url: string, source: string | null): string {
  const slug = slugifyUrl(url);
  const root = source ?? "url";
  return `${root}/${slug}.md`;
}

function slugifyUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "_");
  const base = path || parsed.hostname;
  return `${parsed.hostname}_${base}`
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function renderTreeAnsi(
  node: TreeNode,
  prefix = "",
  isLast = true,
  isRoot = true,
): string {
  const lines: string[] = [];
  const connector = isRoot ? "" : isLast ? "└── " : "├── ";
  const label = node.is_directory
    ? ansis.blue(node.name === "." ? "context/" : `${node.name}/`)
    : node.name;
  lines.push(`${prefix}${connector}${label}`);
  if (node.is_directory && node.children) {
    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    const children = node.children;
    children.forEach((c, i) => {
      const last = i === children.length - 1;
      lines.push(renderTreeAnsi(c, childPrefix, last, false));
    });
  }
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
