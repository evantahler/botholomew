import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { isText } from "istextorbinary";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import { embedSingle } from "../context/embedder.ts";
import {
  type PreparedIngestion,
  prepareIngestion,
  storeIngestion,
} from "../context/ingest.ts";
import type { DbConnection } from "../db/connection.ts";
import {
  type ContextItem,
  deleteContextItemByPath,
  getContextItemByPath,
  listContextItems,
  listContextItemsByPrefix,
  updateContextItem,
  upsertContextItem,
} from "../db/context.ts";
import { getEmbeddingsForItem, hybridSearch } from "../db/embeddings.ts";
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
    .option("-o, --offset <n>", "skip first N items", Number.parseInt)
    .action((opts) =>
      withDb(program, async (conn) => {
        const items = opts.path
          ? await listContextItemsByPrefix(conn, opts.path, {
              recursive: true,
              limit: opts.limit,
              offset: opts.offset,
            })
          : await listContextItems(conn, {
              limit: opts.limit,
              offset: opts.offset,
            });

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
    .command("show <path>")
    .description("Show details and content of a context item")
    .action((path: string) =>
      withDb(program, async (conn) => {
        const item = await getContextItemByPath(conn, path);
        if (!item) {
          logger.error(`Context item not found: ${path}`);
          process.exit(1);
        }

        console.log(ansis.bold(item.title));
        console.log(`  Path:        ${item.context_path}`);
        console.log(`  MIME type:   ${item.mime_type}`);
        if (item.source_path) console.log(`  Source:      ${item.source_path}`);
        const indexed = item.indexed_at
          ? `${ansis.green("yes")} (${fmtDate(item.indexed_at)})`
          : ansis.dim("no");
        console.log(`  Indexed:     ${indexed}`);
        console.log(`  Created:     ${fmtDate(item.created_at)}`);
        console.log(`  Updated:     ${fmtDate(item.updated_at)}`);

        if (item.is_textual && item.content) {
          console.log(`\n${"─".repeat(60)}\n${item.content}`);
        } else if (!item.is_textual) {
          console.log(ansis.dim("\n  (binary content not shown)"));
        }
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

        // Phase 2: Load config and upsert DB records (sequential, fast)
        const config = await loadConfig(dir);
        const upsertSpinner = createSpinner(
          "Adding files to database...",
        ).start();
        const itemIds: { id: string; contextPath: string }[] = [];
        for (const { filePath, contextPath } of filesToAdd) {
          const result = await addFile(conn, filePath, contextPath);
          if (result) itemIds.push({ id: result, contextPath });
        }
        upsertSpinner.success({
          text: `Added ${itemIds.length} file(s) to database.`,
        });

        // Phase 3: Chunk + embed in parallel (network I/O)
        if (itemIds.length === 0 || !config.openai_api_key) {
          if (!config.openai_api_key) {
            logger.dim("Skipping embeddings (no OpenAI API key configured).");
          }
          logger.success(`Added ${itemIds.length} file(s), 0 chunks indexed.`);
          process.exit(0);
        }

        const CONCURRENCY = 10;
        let completed = 0;
        const embedSpinner = createSpinner(
          `Embedding 0/${itemIds.length} files...`,
        ).start();

        const prepared: PreparedIngestion[] = [];
        for (let i = 0; i < itemIds.length; i += CONCURRENCY) {
          const batch = itemIds.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map(async ({ id }) => {
              const result = await prepareIngestion(conn, id, config);
              completed++;
              embedSpinner.update({
                text: `Embedding ${completed}/${itemIds.length} files...`,
              });
              return result;
            }),
          );
          for (const r of results) {
            if (r) prepared.push(r);
          }
        }
        embedSpinner.success({
          text: `Embedded ${prepared.length} file(s).`,
        });

        // Phase 4: Store embeddings (sequential, fast DB writes)
        let chunks = 0;
        let filesAdded = 0;
        let filesUpdated = 0;
        for (const p of prepared) {
          const result = await storeIngestion(conn, p);
          chunks += result.chunks;
          if (result.isUpdate) filesUpdated++;
          else filesAdded++;
        }

        const parts: string[] = [];
        if (filesAdded > 0) parts.push(`${filesAdded} added`);
        if (filesUpdated > 0) parts.push(`${filesUpdated} updated`);
        logger.success(`${parts.join(", ")} — ${chunks} chunk(s) indexed.`);
        process.exit(0);
      }),
    );

  ctx
    .command("search <query>")
    .description("Search context items")
    .option("-k, --top-k <n>", "max results", Number.parseInt, 10)
    .action((query, opts) =>
      withDb(program, async (conn, dir) => {
        const config = await loadConfig(dir);
        const queryVec = await embedSingle(query, config);
        const results = await hybridSearch(conn, query, queryVec, opts.topK);

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
  ctx
    .command("delete <path>")
    .description("Delete a context item by path")
    .action((path: string) =>
      withDb(program, async (conn) => {
        const deleted = await deleteContextItemByPath(conn, path);
        if (!deleted) {
          logger.error(`Context item not found: ${path}`);
          process.exit(1);
        }
        logger.success(`Deleted context item: ${path}`);
      }),
    );
  ctx
    .command("chunks <path>")
    .description("Show chunks and embeddings for a context item")
    .action((path: string) =>
      withDb(program, async (conn) => {
        const item = await getContextItemByPath(conn, path);
        if (!item) {
          logger.error(`Context item not found: ${path}`);
          process.exit(1);
        }

        if (!item.indexed_at) {
          logger.dim("Item has not been indexed yet.");
          return;
        }

        const embeddings = await getEmbeddingsForItem(conn, item.id);

        console.log(ansis.bold(item.title));
        console.log(`  Path:      ${item.context_path}`);
        console.log(`  Indexed:   ${fmtDate(item.indexed_at)}`);
        console.log(`  Chunks:    ${embeddings.length}`);
        console.log("");

        for (const emb of embeddings) {
          const preview = emb.chunk_content
            ? emb.chunk_content.slice(0, 200).replace(/\n/g, " ") +
              (emb.chunk_content.length > 200 ? "..." : "")
            : ansis.dim("(no content)");
          const chars = emb.chunk_content?.length ?? 0;

          console.log(
            `${ansis.bold(`Chunk ${emb.chunk_index}`)}  ${ansis.dim(`${chars} chars, ${emb.embedding.length} dims`)}`,
          );
          console.log(`  ${preview}`);
          console.log("");
        }

        const totalChars = embeddings.reduce(
          (sum, e) => sum + (e.chunk_content?.length ?? 0),
          0,
        );
        console.log(
          ansis.dim(`${embeddings.length} chunk(s), ${totalChars} total chars`),
        );
      }),
    );

  ctx
    .command("refresh [path]")
    .description("Re-import files from disk and re-embed if content changed")
    .option("--all", "refresh all items with a source path")
    .action((path: string | undefined, opts: { all?: boolean }) =>
      withDb(program, async (conn, dir) => {
        const items = await resolveItems(conn, path, !!opts.all);
        if (items.length === 0) {
          logger.error("No matching context items found.");
          process.exit(1);
        }

        const sourced = items.filter((i) => i.source_path);
        if (sourced.length === 0) {
          logger.dim("No items with a source path to refresh.");
          return;
        }
        if (sourced.length < items.length) {
          logger.dim(
            `Skipping ${items.length - sourced.length} item(s) without a source path.`,
          );
        }

        const config = await loadConfig(dir);

        // Phase 1: Read files from disk, compare, and update DB
        const spinner = createSpinner(
          `Refreshing 0/${sourced.length} items...`,
        ).start();
        let updated = 0;
        let unchanged = 0;
        let missing = 0;
        const toReembed: string[] = [];

        for (const [idx, item] of sourced.entries()) {
          spinner.update({
            text: `Refreshing ${idx + 1}/${sourced.length} items...`,
          });
          try {
            const sourcePath = item.source_path as string;
            const bunFile = Bun.file(sourcePath);
            if (!(await bunFile.exists())) {
              missing++;
              logger.warn(`  Missing: ${item.source_path}`);
              continue;
            }
            const content = await bunFile.text();
            if (content === item.content) {
              unchanged++;
              continue;
            }
            await updateContextItem(conn, item.id, { content });
            updated++;
            toReembed.push(item.id);
          } catch (err) {
            logger.warn(`  Error reading ${item.source_path}: ${err}`);
          }
        }
        spinner.success({
          text: `Checked ${sourced.length} file(s): ${updated} updated, ${unchanged} unchanged, ${missing} missing.`,
        });

        // Phase 2: Re-embed changed items
        if (toReembed.length === 0 || !config.openai_api_key) {
          if (toReembed.length > 0 && !config.openai_api_key) {
            logger.dim("Skipping embeddings (no OpenAI API key configured).");
          }
          return;
        }

        const CONCURRENCY = 10;
        let completed = 0;
        const embedSpinner = createSpinner(
          `Embedding 0/${toReembed.length} files...`,
        ).start();

        const prepared: PreparedIngestion[] = [];
        for (let i = 0; i < toReembed.length; i += CONCURRENCY) {
          const batch = toReembed.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map(async (id) => {
              const result = await prepareIngestion(conn, id, config);
              completed++;
              embedSpinner.update({
                text: `Embedding ${completed}/${toReembed.length} files...`,
              });
              return result;
            }),
          );
          for (const r of results) {
            if (r) prepared.push(r);
          }
        }
        embedSpinner.success({
          text: `Embedded ${prepared.length} file(s).`,
        });

        let chunks = 0;
        for (const p of prepared) {
          const result = await storeIngestion(conn, p);
          chunks += result.chunks;
        }

        logger.success(
          `Refreshed ${updated} file(s), ${chunks} chunk(s) re-indexed.`,
        );
      }),
    );
}

async function resolveItems(
  conn: DbConnection,
  path: string | undefined,
  all: boolean,
): Promise<ContextItem[]> {
  if (!path && !all) {
    logger.error("Provide a path or use --all.");
    process.exit(1);
  }
  if (all) return listContextItems(conn);
  const p = path as string;
  const exact = await getContextItemByPath(conn, p);
  if (exact) return [exact];
  return listContextItemsByPrefix(conn, p, { recursive: true });
}

/** Upsert a file into the context DB. Returns the item ID if textual, null otherwise. */
async function addFile(
  conn: DbConnection,
  filePath: string,
  contextPath: string,
): Promise<string | null> {
  try {
    const bunFile = Bun.file(filePath);
    const mimeType = bunFile.type.split(";")[0] || "application/octet-stream";
    const filename = basename(filePath);
    const textual = isText(filename) !== false;
    const content = textual ? await bunFile.text() : null;

    const item = await upsertContextItem(conn, {
      title: filename,
      content: content ?? undefined,
      mimeType,
      sourcePath: filePath,
      contextPath,
      isTextual: textual,
    });

    return textual && content ? item.id : null;
  } catch (err) {
    logger.warn(`  ! ${contextPath}: ${err}`);
    return null;
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
