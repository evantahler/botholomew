import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { isText } from "istextorbinary";
import { loadConfig } from "../config/loader.ts";
import { getDbPath } from "../constants.ts";
import { embedSingle, warmupEmbedder } from "../context/embedder.ts";
import { ingestContextItem } from "../context/ingest.ts";
import { getConnection } from "../db/connection.ts";
import {
  createContextItem,
  listContextItems,
  listContextItemsByPrefix,
} from "../db/context.ts";
import { hybridSearch, initVectorSearch } from "../db/embeddings.ts";
import { migrate } from "../db/schema.ts";
import { logger } from "../utils/logger.ts";

export function registerContextCommand(program: Command) {
  const ctx = program.command("context").description("Manage context items");

  ctx
    .command("list")
    .description("List context items")
    .option("--path <prefix>", "filter by path prefix")
    .option("-l, --limit <n>", "max number of items", Number.parseInt)
    .action(async (opts) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const items = opts.path
        ? await listContextItemsByPrefix(conn, opts.path, {
            recursive: true,
            limit: opts.limit,
          })
        : await listContextItems(conn, { limit: opts.limit });

      if (items.length === 0) {
        logger.dim("No context items found.");
        conn.close();
        return;
      }

      const header = `${ansis.bold("Path".padEnd(40))} ${"Title".padEnd(25)} ${"Type".padEnd(20)} Indexed`;
      console.log(header);
      console.log("-".repeat(header.length));

      for (const item of items) {
        const indexed = item.indexed_at ? ansis.green("yes") : ansis.dim("no");
        console.log(
          `${item.context_path.padEnd(40)} ${item.title.slice(0, 24).padEnd(25)} ${item.mime_type.slice(0, 19).padEnd(20)} ${indexed}`,
        );
      }

      console.log(`\n${ansis.dim(`${items.length} item(s)`)}`);
      conn.close();
    });

  ctx
    .command("add <path>")
    .description("Add a file or directory to context")
    .option("--prefix <prefix>", "virtual path prefix", "/")
    .action(async (path, opts) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);
      const config = await loadConfig(dir);
      await warmupEmbedder();

      const resolvedPath = resolve(path);
      const info = await stat(resolvedPath);

      let added = 0;
      let chunks = 0;

      if (info.isDirectory()) {
        const entries = await walkDirectory(resolvedPath);
        for (const filePath of entries) {
          const relativePath = filePath.slice(resolvedPath.length);
          const contextPath = join(opts.prefix, relativePath);
          const count = await addFile(conn, config, filePath, contextPath);
          if (count >= 0) {
            added++;
            chunks += count;
          }
        }
      } else {
        const contextPath = join(opts.prefix, basename(resolvedPath));
        const count = await addFile(conn, config, resolvedPath, contextPath);
        if (count >= 0) {
          added++;
          chunks += count;
        }
      }

      logger.success(`Added ${added} file(s), ${chunks} chunk(s) indexed.`);
      conn.close();
    });

  ctx
    .command("search <query>")
    .description("Search context items")
    .option("-k, --top-k <n>", "max results", Number.parseInt, 10)
    .action(async (query, opts) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      await warmupEmbedder();
      initVectorSearch(conn);
      const queryVec = await embedSingle(query);
      const results = hybridSearch(conn, query, queryVec, opts.topK);

      if (results.length === 0) {
        logger.dim("No results found.");
        conn.close();
        return;
      }

      for (const [i, r] of results.entries()) {
        const score = (r.score * 100).toFixed(1);
        console.log(
          `${ansis.bold(`${i + 1}.`)} ${ansis.cyan(r.title)} ${ansis.dim(`(${score}%)`)}`,
        );
        console.log(`   ${ansis.dim(r.source_path || r.context_item_id)}`);
        if (r.chunk_content) {
          const snippet = r.chunk_content.slice(0, 120).replace(/\n/g, " ");
          console.log(`   ${snippet}...`);
        }
        console.log("");
      }

      conn.close();
    });
}

async function addFile(
  conn: ReturnType<typeof getConnection>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  filePath: string,
  contextPath: string,
): Promise<number> {
  try {
    const bunFile = Bun.file(filePath);
    const mimeType = bunFile.type.split(";")[0] || "application/octet-stream";
    const filename = basename(filePath);
    const textual = isText(filename) !== false;

    const content = textual ? await bunFile.text() : null;

    const item = await createContextItem(conn, {
      title: filename,
      content: content ?? undefined,
      mimeType,
      sourcePath: filePath,
      contextPath,
      isTextual: textual,
    });

    if (textual && content) {
      const count = await ingestContextItem(conn, item.id, config);
      console.log(`  + ${contextPath} (${count} chunks)`);
      return count;
    }

    console.log(`  + ${contextPath} (binary, not indexed)`);
    return 0;
  } catch (err) {
    logger.warn(`  ! ${contextPath}: ${err}`);
    return -1;
  }
}

async function walkDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue; // skip hidden dirs
      files.push(...(await walkDirectory(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}
