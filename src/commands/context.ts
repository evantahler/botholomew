import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { isText } from "istextorbinary";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import { embedSingle, warmupEmbedder } from "../context/embedder.ts";
import { ingestContextItem } from "../context/ingest.ts";
import type { DbConnection } from "../db/connection.ts";
import {
  createContextItem,
  listContextItems,
  listContextItemsByPrefix,
} from "../db/context.ts";
import { hybridSearch, initVectorSearch } from "../db/embeddings.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function registerContextCommand(program: Command) {
  const ctx = program.command("context").description("Manage context items");

  ctx
    .command("list")
    .description("List context items")
    .option("--path <prefix>", "filter by path prefix")
    .option("-l, --limit <n>", "max number of items", Number.parseInt)
    .action((opts) =>
      withDb(program, async (conn) => {
        const items = opts.path
          ? await listContextItemsByPrefix(conn, opts.path, {
              recursive: true,
              limit: opts.limit,
            })
          : await listContextItems(conn, { limit: opts.limit });

        if (items.length === 0) {
          logger.dim("No context items found.");
          return;
        }

        const header = `${ansis.bold("Path".padEnd(40))} ${"Title".padEnd(25)} ${"Type".padEnd(20)} ${"Updated".padEnd(18)} Indexed`;
        console.log(header);
        console.log("-".repeat(header.length));

        for (const item of items) {
          const indexed = item.indexed_at
            ? ansis.green("yes")
            : ansis.dim("no");
          const updated = ansis.dim(fmtDate(item.updated_at).padEnd(18));
          console.log(
            `${item.context_path.padEnd(40)} ${item.title.slice(0, 24).padEnd(25)} ${item.mime_type.slice(0, 19).padEnd(20)} ${updated} ${indexed}`,
          );
        }

        console.log(`\n${ansis.dim(`${items.length} item(s)`)}`);
      }),
    );

  ctx
    .command("add <paths...>")
    .description("Add files or directories to context")
    .option("--prefix <prefix>", "virtual path prefix", "/")
    .action((paths: string[], opts) =>
      withDb(program, async (conn, dir) => {
        // Phase 1: Scan all paths and validate they exist
        const filesToAdd: { filePath: string; contextPath: string }[] = [];
        const spinner = createSpinner("Scanning files...").start();

        for (const path of paths) {
          const resolvedPath = resolve(path);
          let info: Awaited<ReturnType<typeof stat>>;
          try {
            info = await stat(resolvedPath);
          } catch {
            spinner.error({ text: `Path not found: ${resolvedPath}` });
            process.exit(1);
          }

          if (info.isDirectory()) {
            const entries = await walkDirectory(resolvedPath);
            for (const filePath of entries) {
              const relativePath = filePath.slice(resolvedPath.length);
              filesToAdd.push({
                filePath,
                contextPath: join(opts.prefix, relativePath),
              });
            }
          } else {
            filesToAdd.push({
              filePath: resolvedPath,
              contextPath: join(opts.prefix, basename(resolvedPath)),
            });
          }
        }

        spinner.success({
          text: `Found ${filesToAdd.length} file(s) to add.`,
        });

        // Phase 2: Warmup embedder
        const embedSpinner = createSpinner(
          "Loading embedding model...",
        ).start();
        const config = await loadConfig(dir);
        await warmupEmbedder();
        embedSpinner.success({ text: "Embedding model loaded." });

        // Phase 3: Process files one-by-one
        let added = 0;
        let chunks = 0;

        for (const [i, { filePath, contextPath }] of filesToAdd.entries()) {
          const fileSpinner = createSpinner(
            `Processing ${basename(filePath)} (${i + 1}/${filesToAdd.length})...`,
          ).start();
          const count = await addFile(conn, config, filePath, contextPath);
          if (count >= 0) {
            added++;
            chunks += count;
            fileSpinner.success({
              text: `${contextPath} (${count} chunks)`,
            });
          } else {
            fileSpinner.warn({ text: `${contextPath}: skipped` });
          }
        }

        logger.success(`Added ${added} file(s), ${chunks} chunk(s) indexed.`);
        process.exit(0);
      }),
    );

  ctx
    .command("search <query>")
    .description("Search context items")
    .option("-k, --top-k <n>", "max results", Number.parseInt, 10)
    .action((query, opts) =>
      withDb(program, async (conn) => {
        await warmupEmbedder();
        initVectorSearch(conn);
        const queryVec = await embedSingle(query);
        const results = hybridSearch(conn, query, queryVec, opts.topK);

        if (results.length === 0) {
          logger.dim("No results found.");
          return;
        }

        for (const [i, r] of results.entries()) {
          const score = (r.score * 100).toFixed(1);
          console.log(
            `${ansis.bold(`${i + 1}.`)} ${ansis.cyan(r.title)} ${ansis.dim(`(${score}%)`)}`,
          );
          console.log(
            `   ${ansis.dim(r.source_path || r.context_item_id)}  ${ansis.dim(fmtDate(r.created_at))}`,
          );
          if (r.chunk_content) {
            const snippet = r.chunk_content.slice(0, 120).replace(/\n/g, " ");
            console.log(`   ${snippet}...`);
          }
          console.log("");
        }
      }),
    );
}

async function addFile(
  conn: DbConnection,
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
      return await ingestContextItem(conn, item.id, config);
    }

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
