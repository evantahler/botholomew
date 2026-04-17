import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { isText } from "istextorbinary";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import { generateDescription } from "../context/describer.ts";
import { embedSingle } from "../context/embedder.ts";
import { FetchFailureError, fetchUrl } from "../context/fetcher.ts";
import {
  type PreparedIngestion,
  prepareIngestion,
  storeIngestion,
} from "../context/ingest.ts";
import { refreshContextItems } from "../context/refresh.ts";
import { isUrl, urlToContextPath } from "../context/url-utils.ts";
import type { DbConnection } from "../db/connection.ts";
import {
  type ContextItem,
  deleteContextItemByPath,
  listContextItems,
  listContextItemsByPrefix,
  resolveContextItem,
  upsertContextItem,
} from "../db/context.ts";
import { getEmbeddingsForItem, hybridSearch } from "../db/embeddings.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { logger } from "../utils/logger.ts";
import {
  registerContextToolSubcommands,
  registerSearchToolSubcommands,
} from "./tools.ts";
import { withDb } from "./with-db.ts";

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function registerContextCommand(program: Command) {
  const ctx = program.command("context").description("Manage context");

  ctx
    .command("list")
    .description("List context entries")
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
          logger.dim("No context entries found.");
          return;
        }

        const header = `${ansis.bold("ID".padEnd(36))} ${ansis.bold("Path".padEnd(35))} ${"Title".padEnd(20)} ${"Description".padEnd(30)} ${"Source".padEnd(6)} ${"Type".padEnd(15)} ${"Updated".padEnd(18)} Indexed`;
        console.log(header);
        console.log("-".repeat(header.length));

        for (const item of items) {
          const indexed = item.indexed_at
            ? ansis.green("yes")
            : ansis.dim("no");
          const updated = ansis.dim(fmtDate(item.updated_at).padEnd(18));
          const desc = item.description
            ? ansis.dim(item.description.slice(0, 29).padEnd(30))
            : ansis.dim("".padEnd(30));
          const source =
            item.source_type === "url"
              ? ansis.cyan("url".padEnd(6))
              : ansis.dim("file".padEnd(6));
          const id = ansis.dim(item.id.padEnd(36));
          console.log(
            `${id} ${item.context_path.slice(0, 34).padEnd(35)} ${item.title.slice(0, 19).padEnd(20)} ${desc} ${source} ${item.mime_type.slice(0, 14).padEnd(15)} ${updated} ${indexed}`,
          );
        }

        console.log(`\n${ansis.dim(`${items.length} item(s)`)}`);
      }),
    );

  ctx
    .command("add <paths...>")
    .description("Add files, directories, or URLs to context")
    .option("--prefix <prefix>", "virtual path prefix", "/")
    .option("--name <path>", "custom context path (single URL only)")
    .option(
      "--prompt-addition <text>",
      "extra guidance for the URL fetcher agent (e.g., auth notes, tool hints)",
    )
    .action((paths: string[], opts) =>
      withDb(program, async (conn, dir) => {
        // Phase 1: Scan all paths — separate URLs from local files
        const filesToAdd: { filePath: string; contextPath: string }[] = [];
        const urlsToAdd: { url: string; contextPath: string }[] = [];
        const spinner = createSpinner("Scanning paths...").start();

        // Validate --name: only valid with a single URL
        if (opts.name && (paths.length > 1 || !paths[0] || !isUrl(paths[0]))) {
          spinner.error({
            text: "--name can only be used with a single URL",
          });
          process.exit(1);
        }

        for (const path of paths) {
          if (isUrl(path)) {
            const contextPath =
              opts.name || urlToContextPath(path, opts.prefix);
            urlsToAdd.push({ url: path, contextPath });
          } else {
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
        }

        const totalCount = filesToAdd.length + urlsToAdd.length;
        spinner.success({
          text: `Found ${totalCount} item(s) to add (${filesToAdd.length} file(s), ${urlsToAdd.length} URL(s)).`,
        });

        // Phase 2: Load config and upsert DB records (batched, parallel LLM descriptions)
        const config = await loadConfig(dir);
        const CONCURRENCY = 10;
        let addCompleted = 0;
        const itemIds: { id: string; contextPath: string }[] = [];

        // Process local files (with spinner — these are quick, no chatty logs)
        if (filesToAdd.length > 0) {
          const fileSpinner = createSpinner(
            `Adding and describing 0/${filesToAdd.length} file(s)...`,
          ).start();

          for (let i = 0; i < filesToAdd.length; i += CONCURRENCY) {
            const batch = filesToAdd.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async ({ filePath, contextPath }) => {
                const result = await addFile(
                  conn,
                  filePath,
                  contextPath,
                  config,
                );
                addCompleted++;
                fileSpinner.update({
                  text: `Adding and describing ${addCompleted}/${filesToAdd.length} file(s)...`,
                });
                return result ? { id: result, contextPath } : null;
              }),
            );
            for (const r of results) {
              if (r) itemIds.push(r);
            }
          }

          fileSpinner.success({
            text: `Added and described ${addCompleted} file(s).`,
          });
        }

        // Process URLs (no spinner — agent logs would interleave; render cleanly instead)
        if (urlsToAdd.length > 0) {
          const mcpxClient = await createMcpxClient(dir);
          if (!mcpxClient) {
            logger.dim(
              "No MCP servers configured — remote fetches will use basic HTTP.",
            );
          }

          let urlIdx = 0;
          let urlAdded = 0;
          for (const { url, contextPath } of urlsToAdd) {
            urlIdx++;
            console.log(
              `\n${ansis.bold(`[${urlIdx}/${urlsToAdd.length}]`)} ${ansis.cyan(url)}`,
            );
            const result = await addUrl(
              conn,
              config,
              url,
              contextPath,
              mcpxClient,
              opts.promptAddition,
            );
            if (result.ok) {
              urlAdded++;
              itemIds.push({ id: result.id, contextPath });
              console.log(`  ${ansis.green("✔")} stored at ${contextPath}`);
            } else if (result.actionable) {
              console.log(
                `  ${ansis.red("✗")} ${ansis.bold("action required:")}`,
              );
              for (const line of result.error.split("\n")) {
                console.log(`      ${ansis.yellow(line)}`);
              }
            } else {
              console.log(
                `  ${ansis.red("✗")} failed to fetch: ${result.error}`,
              );
            }
          }

          const urlSummary = `Added ${urlAdded}/${urlsToAdd.length} URL(s).`;
          if (urlAdded === urlsToAdd.length) {
            console.log(`\n${ansis.green("✔")} ${urlSummary}`);
          } else if (urlAdded === 0) {
            console.log(`\n${ansis.red("✗")} ${urlSummary}`);
          } else {
            console.log(`\n${ansis.yellow("⚠")} ${urlSummary}`);
          }
        }

        // Phase 3: Chunk + embed in parallel (network I/O)
        if (itemIds.length === 0 || !config.openai_api_key) {
          if (!config.openai_api_key) {
            logger.dim("Skipping embeddings (no OpenAI API key configured).");
          }
          const msg = `Added ${itemIds.length}/${totalCount} item(s), 0 chunks indexed.`;
          if (itemIds.length === totalCount) {
            logger.success(msg);
            process.exit(0);
          } else if (itemIds.length === 0) {
            logger.error(msg);
            process.exit(1);
          } else {
            logger.warn(msg);
            process.exit(1);
          }
        }

        let completed = 0;
        const embedSpinner = createSpinner(
          `Embedding 0/${itemIds.length} items...`,
        ).start();

        const prepared: PreparedIngestion[] = [];
        for (let i = 0; i < itemIds.length; i += CONCURRENCY) {
          const batch = itemIds.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map(async ({ id }) => {
              const result = await prepareIngestion(conn, id, config);
              completed++;
              embedSpinner.update({
                text: `Embedding ${completed}/${itemIds.length} items...`,
              });
              return result;
            }),
          );
          for (const r of results) {
            if (r) prepared.push(r);
          }
        }
        embedSpinner.success({
          text: `Embedded ${prepared.length} item(s).`,
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
        const summary = `${parts.join(", ")} — ${chunks} chunk(s) indexed (${itemIds.length}/${totalCount} item(s)).`;
        if (itemIds.length === totalCount) {
          logger.success(summary);
          process.exit(0);
        } else {
          logger.warn(summary);
          process.exit(1);
        }
      }),
    );

  const search = ctx
    .command("search")
    .description("Search context entries")
    .argument("[query]", "search query (hybrid keyword + semantic)")
    .option("-k, --top-k <n>", "max results", Number.parseInt, 10)
    .action((query, opts) =>
      withDb(program, async (conn, dir) => {
        if (!query) {
          search.help();
          return;
        }
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

  registerSearchToolSubcommands(search);
  ctx
    .command("delete <path>")
    .description("Delete a context entry by path")
    .action((path: string) =>
      withDb(program, async (conn) => {
        const deleted = await deleteContextItemByPath(conn, path);
        if (!deleted) {
          logger.error(`Context entry not found: ${path}`);
          process.exit(1);
        }
        logger.success(`Deleted context entry: ${path}`);
      }),
    );
  ctx
    .command("chunks <path>")
    .description("Show chunks and embeddings for a context entry")
    .action((path: string) =>
      withDb(program, async (conn) => {
        const item = await resolveContextItem(conn, path);
        if (!item) {
          logger.error(`Context entry not found: ${path}`);
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
    .description(
      "Re-import files from disk / re-fetch URLs and re-embed if content changed",
    )
    .option("--all", "refresh all items with a source path")
    .action((path: string | undefined, opts: { all?: boolean }) =>
      withDb(program, async (conn, dir) => {
        const items = await resolveItems(conn, path, !!opts.all);
        if (items.length === 0) {
          logger.error("No matching context entries found.");
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

        // Init MCPX client if any URL items need refreshing
        const hasUrls = sourced.some((i) => i.source_type === "url");
        const mcpxClient = hasUrls ? await createMcpxClient(dir) : null;

        const refreshSpinner = createSpinner(
          `Refreshing 0/${sourced.length} items...`,
        ).start();
        const embedSpinner = createSpinner("Embedding 0 item(s)...");

        const result = await refreshContextItems(
          conn,
          sourced,
          config,
          mcpxClient,
          {
            onItemProgress: (done, total) => {
              refreshSpinner.update({
                text: `Refreshing ${done}/${total} items...`,
              });
            },
            onEmbedProgress: (done, total) => {
              if (done === 1) embedSpinner.start();
              embedSpinner.update({
                text: `Embedding ${done}/${total} item(s)...`,
              });
            },
          },
        );

        refreshSpinner.success({
          text: `Checked ${result.checked} item(s): ${result.updated} updated, ${result.unchanged} unchanged, ${result.missing} missing.`,
        });

        for (const item of result.items) {
          if (item.status === "missing") {
            logger.warn(`  Missing: ${item.source_path}`);
          } else if (item.status === "error") {
            logger.warn(
              `  Error refreshing ${item.source_path}: ${item.error}`,
            );
          }
        }

        if (result.reembedded > 0) {
          embedSpinner.success({
            text: `Embedded ${result.reembedded} item(s).`,
          });
          logger.success(
            `Refreshed ${result.updated} item(s), ${result.chunks} chunk(s) re-indexed.`,
          );
        } else if (result.embeddings_skipped) {
          logger.dim("Skipping embeddings (no OpenAI API key configured).");
        }
      }),
    );

  // Register context tool subcommands (read, write, edit, list-dir, etc.)
  // Must come after management subcommands so collision detection works.
  registerContextToolSubcommands(ctx);
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
  const exact = await resolveContextItem(conn, p);
  if (exact) return [exact];
  return listContextItemsByPrefix(conn, p, { recursive: true });
}

/** Upsert a file into context. Returns the item ID if textual, null otherwise. */
async function addFile(
  conn: DbConnection,
  filePath: string,
  contextPath: string,
  config: Required<BotholomewConfig>,
): Promise<string | null> {
  try {
    const bunFile = Bun.file(filePath);
    const mimeType = bunFile.type.split(";")[0] || "application/octet-stream";
    const filename = basename(filePath);
    const textual = isText(filename) !== false;
    const content = textual ? await bunFile.text() : null;

    const description = await generateDescription(config, {
      filename,
      mimeType,
      content,
      filePath,
    });

    const item = await upsertContextItem(conn, {
      title: filename,
      description,
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

/** Fetch a URL and upsert into context. Returns the item ID, or null on failure. */
type AddUrlResult =
  | { ok: true; id: string }
  | { ok: false; error: string; actionable: boolean };

async function addUrl(
  conn: DbConnection,
  config: Required<BotholomewConfig>,
  url: string,
  contextPath: string,
  mcpxClient: Awaited<ReturnType<typeof createMcpxClient>>,
  promptAddition?: string,
): Promise<AddUrlResult> {
  try {
    const fetched = await fetchUrl(url, config, mcpxClient, promptAddition);

    const description = await generateDescription(config, {
      filename: new URL(url).hostname,
      mimeType: fetched.mimeType,
      content: fetched.content,
    });

    const item = await upsertContextItem(conn, {
      title: fetched.title,
      description,
      content: fetched.content,
      mimeType: fetched.mimeType,
      sourceType: "url",
      sourcePath: url,
      contextPath,
      isTextual: true,
    });

    return { ok: true, id: item.id };
  } catch (err) {
    if (err instanceof FetchFailureError) {
      return { ok: false, error: err.userMessage, actionable: true };
    }
    return { ok: false, error: String(err), actionable: false };
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
