import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { isText } from "istextorbinary";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import {
  generateDescription,
  generateDescriptionAndPath,
} from "../context/describer.ts";
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
  createContextItemStrict,
  deleteContextItemByPath,
  getContextItemByPath,
  getContextItemBySourcePath,
  listContextItems,
  listContextItemsByPrefix,
  PathConflictError,
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
    .option(
      "--prefix <prefix>",
      "virtual path prefix (if omitted, an LLM suggests a folder for each file)",
    )
    .option("--name <path>", "custom context path (single URL only)")
    .option(
      "--on-conflict <policy>",
      "collision policy: error | overwrite | skip",
      "error",
    )
    .option(
      "--auto-place",
      "accept all LLM-suggested paths without confirmation",
    )
    .option(
      "--prompt-addition <text>",
      "extra guidance for the URL fetcher agent (e.g., auth notes, tool hints)",
    )
    .action((paths: string[], opts) =>
      withDb(program, async (conn, dir) => {
        type ConflictPolicy = "error" | "overwrite" | "skip";
        const policy = opts.onConflict as ConflictPolicy;
        if (!["error", "overwrite", "skip"].includes(policy)) {
          logger.error(
            `Invalid --on-conflict value: ${policy} (must be error, overwrite, or skip)`,
          );
          process.exit(1);
        }

        // Phase 1: Scan all paths — separate URLs from local files
        type FileToAdd = {
          filePath: string;
          contextPath: string | null; // null = defer to LLM placement
        };
        const filesToAdd: FileToAdd[] = [];
        const urlsToAdd: { url: string; contextPath: string }[] = [];
        const spinner = createSpinner("Scanning paths...").start();

        // Validate --name: only valid with a single URL
        if (opts.name && (paths.length > 1 || !paths[0] || !isUrl(paths[0]))) {
          spinner.error({
            text: "--name can only be used with a single URL",
          });
          process.exit(1);
        }

        // Explicit placement: user passed --prefix (or --name for URLs).
        // Implicit placement: LLM decides per-file.
        const explicitPlacement = typeof opts.prefix === "string";
        const urlPrefix = opts.prefix ?? "/";

        for (const path of paths) {
          if (isUrl(path)) {
            const contextPath = opts.name || urlToContextPath(path, urlPrefix);
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
                  contextPath: explicitPlacement
                    ? join(opts.prefix, relativePath)
                    : null,
                });
              }
            } else {
              filesToAdd.push({
                filePath: resolvedPath,
                contextPath: explicitPlacement
                  ? join(opts.prefix, basename(resolvedPath))
                  : null,
              });
            }
          }
        }

        const totalCount = filesToAdd.length + urlsToAdd.length;
        spinner.success({
          text: `Found ${totalCount} item(s) to add (${filesToAdd.length} file(s), ${urlsToAdd.length} URL(s)).`,
        });

        const config = await loadConfig(dir);
        const CONCURRENCY = 10;

        // Phase 0: Source-path dedup — items whose source_path is already in
        // context are routed per --on-conflict before we pay for LLM placement.
        type AlreadyInContext = {
          sourcePath: string;
          sourceType: "file" | "url";
          existing: ContextItem;
        };
        const alreadyInContext: AlreadyInContext[] = [];
        const remainingFiles: FileToAdd[] = [];
        const remainingUrls: { url: string; contextPath: string }[] = [];

        for (const f of filesToAdd) {
          const existing = await getContextItemBySourcePath(
            conn,
            f.filePath,
            "file",
          );
          if (existing) {
            alreadyInContext.push({
              sourcePath: f.filePath,
              sourceType: "file",
              existing,
            });
          } else {
            remainingFiles.push(f);
          }
        }
        for (const u of urlsToAdd) {
          const existing = await getContextItemBySourcePath(conn, u.url, "url");
          if (existing) {
            alreadyInContext.push({
              sourcePath: u.url,
              sourceType: "url",
              existing,
            });
          } else {
            remainingUrls.push(u);
          }
        }

        let refreshedCount = 0;
        let refreshedChunks = 0;
        const dedupSkipped: string[] = [];

        if (alreadyInContext.length > 0) {
          if (policy === "error") {
            logger.error(
              `${alreadyInContext.length} item(s) already in context (matched by source path):`,
            );
            for (const a of alreadyInContext) {
              console.log(
                `  ${ansis.red("✗")} ${a.sourcePath} → ${a.existing.context_path} (id: ${a.existing.id})`,
              );
            }
            logger.dim(
              "Re-run with --on-conflict=skip to ignore these items or --on-conflict=overwrite to refresh them from disk.",
            );
            process.exit(1);
          }

          if (policy === "skip") {
            for (const a of alreadyInContext) {
              logger.dim(
                `⊘ already in context: ${a.sourcePath} → ${a.existing.context_path}`,
              );
              dedupSkipped.push(a.existing.context_path);
            }
          } else {
            // overwrite: refresh existing items (diff + selective re-embed),
            // preserving their original context_path.
            const itemsToRefresh = alreadyInContext.map((a) => a.existing);
            const hasUrls = itemsToRefresh.some((i) => i.source_type === "url");
            const mcpxClient = hasUrls ? await createMcpxClient(dir) : null;

            const refreshSpinner = createSpinner(
              `Refreshing 0/${itemsToRefresh.length} existing item(s)...`,
            ).start();
            const refreshResult = await refreshContextItems(
              conn,
              itemsToRefresh,
              config,
              mcpxClient,
              {
                onItemProgress: (done, total) => {
                  refreshSpinner.update({
                    text: `Refreshing ${done}/${total} existing item(s)...`,
                  });
                },
              },
            );
            refreshSpinner.success({
              text: `Refreshed ${refreshResult.checked} existing item(s): ${refreshResult.updated} updated, ${refreshResult.unchanged} unchanged, ${refreshResult.missing} missing.`,
            });

            // Count everything we processed OK (updated + unchanged) as
            // "refreshed" for the summary. Missing/error items are reported
            // inline below and don't count toward success.
            refreshedCount = refreshResult.updated + refreshResult.unchanged;
            refreshedChunks = refreshResult.chunks;
            for (const item of refreshResult.items) {
              if (item.status === "missing") {
                logger.warn(`  Missing: ${item.source_path}`);
              } else if (item.status === "error") {
                logger.warn(
                  `  Error refreshing ${item.source_path}: ${item.error}`,
                );
              }
            }
          }
        }

        // Drop already-handled items from the work lists so downstream phases
        // (LLM placement, description, insert, embed) see only truly-new items.
        filesToAdd.splice(0, filesToAdd.length, ...remainingFiles);
        urlsToAdd.splice(0, urlsToAdd.length, ...remainingUrls);

        // Phase 1.5: LLM placement for files without an explicit path
        const needsPlacement = filesToAdd.filter((f) => f.contextPath === null);
        // description cache keyed by filePath — populated when LLM placement runs,
        // reused in addFile to avoid a second describe call.
        const descriptionCache = new Map<string, string>();

        if (needsPlacement.length > 0) {
          if (!config.anthropic_api_key) {
            logger.error(
              "No anthropic_api_key configured — cannot auto-place files. Pass --prefix to specify a folder.",
            );
            process.exit(1);
          }

          const existingTree = await renderExistingTree(conn);
          const placeSpinner = createSpinner(
            `Choosing paths for 0/${needsPlacement.length} file(s)...`,
          ).start();
          let placed = 0;

          for (let i = 0; i < needsPlacement.length; i += CONCURRENCY) {
            const batch = needsPlacement.slice(i, i + CONCURRENCY);
            await Promise.all(
              batch.map(async (entry) => {
                const suggestion = await suggestPathForFile(
                  entry.filePath,
                  config,
                  existingTree,
                );
                entry.contextPath =
                  suggestion?.suggested_path ?? `/${basename(entry.filePath)}`;
                if (suggestion?.description) {
                  descriptionCache.set(entry.filePath, suggestion.description);
                }
                placed++;
                placeSpinner.update({
                  text: `Choosing paths for ${placed}/${needsPlacement.length} file(s)...`,
                });
              }),
            );
          }
          placeSpinner.success({
            text: `Chose paths for ${placed} file(s).`,
          });

          // Confirm in TTY unless --auto-place
          const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
          if (isTTY && !opts.autoPlace) {
            console.log("");
            console.log(ansis.bold("Suggested paths:"));
            for (const entry of needsPlacement) {
              console.log(
                `  ${ansis.dim(entry.filePath)} → ${ansis.cyan(entry.contextPath ?? "")}`,
              );
            }
            const accepted = await confirmYesNo("Accept these paths? (Y/n): ");
            if (!accepted) {
              logger.warn(
                "Aborted. Re-run with --prefix to place files manually, or --auto-place to skip this prompt.",
              );
              process.exit(1);
            }
          }
        }

        // Phase 2: Upsert DB records (batched, parallel LLM descriptions)
        let addCompleted = 0;
        const itemIds: { id: string; contextPath: string }[] = [];
        const conflicts: { contextPath: string; existingId: string }[] = [];
        const skipped: string[] = [];

        // Process local files (with spinner — these are quick, no chatty logs)
        if (filesToAdd.length > 0) {
          const fileSpinner = createSpinner(
            `Adding and describing 0/${filesToAdd.length} file(s)...`,
          ).start();

          for (let i = 0; i < filesToAdd.length; i += CONCURRENCY) {
            const batch = filesToAdd.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async ({ filePath, contextPath }) => {
                if (contextPath === null) return null; // unreachable — placement filled it
                const result = await addFile(
                  conn,
                  filePath,
                  contextPath,
                  config,
                  policy,
                  descriptionCache.get(filePath),
                );
                addCompleted++;
                fileSpinner.update({
                  text: `Adding and describing ${addCompleted}/${filesToAdd.length} file(s)...`,
                });
                return result;
              }),
            );
            for (const r of results) {
              if (!r) continue;
              if (r.kind === "added") {
                itemIds.push({ id: r.id, contextPath: r.contextPath });
              } else if (r.kind === "conflict") {
                conflicts.push({
                  contextPath: r.contextPath,
                  existingId: r.existingId,
                });
              } else if (r.kind === "skipped") {
                skipped.push(r.contextPath);
              }
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
              policy,
            );
            if (result.ok) {
              urlAdded++;
              itemIds.push({ id: result.id, contextPath });
              console.log(`  ${ansis.green("✔")} stored at ${contextPath}`);
            } else if (result.kind === "conflict") {
              conflicts.push({
                contextPath,
                existingId: result.existingId,
              });
              console.log(
                `  ${ansis.red("✗")} path already exists: ${contextPath}`,
              );
            } else if (result.kind === "skipped") {
              skipped.push(contextPath);
              console.log(
                `  ${ansis.yellow("⊘")} skipped (path exists): ${contextPath}`,
              );
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

        // Report conflicts before embeddings so the user sees them prominently.
        // Phase 0 already handled source-path matches, so anything here is a
        // target-path collision — an LLM-suggested (or explicit) path that
        // another unrelated item already occupies.
        if (conflicts.length > 0) {
          logger.error(
            `${conflicts.length} target-path collision(s) — nothing written for these items:`,
          );
          for (const c of conflicts) {
            console.log(
              `  ${ansis.red("✗")} ${c.contextPath} (existing id: ${c.existingId})`,
            );
          }
          logger.dim(
            "The suggested path is already in use by a different source. Re-run with --prefix to place these items elsewhere, or delete the existing item first.",
          );
        }

        // Merge Phase 0 skips into the skip list used by the final summary.
        skipped.push(...dedupSkipped);

        // Phase 3: Chunk + embed in parallel (network I/O)
        if (itemIds.length === 0 || !config.openai_api_key) {
          if (!config.openai_api_key) {
            logger.dim("Skipping embeddings (no OpenAI API key configured).");
          }
          const msg = buildSummary({
            added: itemIds.length,
            refreshed: refreshedCount,
            skipped: skipped.length,
            chunks: refreshedChunks,
            totalCount,
            handled: itemIds.length + refreshedCount + skipped.length,
          });
          if (conflicts.length > 0) {
            logger.error(msg);
            process.exit(1);
          }
          if (itemIds.length + skipped.length + refreshedCount >= totalCount) {
            logger.success(msg);
            process.exit(0);
          } else if (itemIds.length === 0 && refreshedCount === 0) {
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

        const summary = buildSummary({
          added: filesAdded,
          updated: filesUpdated,
          refreshed: refreshedCount,
          skipped: skipped.length,
          chunks: chunks + refreshedChunks,
          totalCount,
          handled: itemIds.length + refreshedCount + skipped.length,
        });
        if (conflicts.length > 0) {
          logger.error(summary);
          process.exit(1);
        }
        if (itemIds.length + skipped.length + refreshedCount >= totalCount) {
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

type ConflictPolicy = "error" | "overwrite" | "skip";

/** Format the final "X added, Y refreshed, Z skipped — N chunks" line. */
function buildSummary(args: {
  added: number;
  updated?: number;
  refreshed: number;
  skipped: number;
  chunks: number;
  totalCount: number;
  handled?: number;
}): string {
  const parts: string[] = [];
  if (args.added > 0) parts.push(`${args.added} added`);
  if (args.updated && args.updated > 0) parts.push(`${args.updated} updated`);
  if (args.refreshed > 0) parts.push(`${args.refreshed} refreshed`);
  if (args.skipped > 0) parts.push(`${args.skipped} skipped`);
  const body = parts.length > 0 ? parts.join(", ") : "0 added";
  const handled = args.handled ?? args.added + args.refreshed + args.skipped;
  return `${body} — ${args.chunks} chunk(s) indexed (${handled}/${args.totalCount} item(s)).`;
}

type AddFileResult =
  | { kind: "added"; id: string; contextPath: string }
  | { kind: "skipped"; contextPath: string }
  | { kind: "conflict"; contextPath: string; existingId: string }
  | { kind: "failed"; contextPath: string; error: string };

/** Upsert a file into context honoring the collision policy. */
async function addFile(
  conn: DbConnection,
  filePath: string,
  contextPath: string,
  config: Required<BotholomewConfig>,
  policy: ConflictPolicy,
  cachedDescription?: string,
): Promise<AddFileResult | null> {
  try {
    // Pre-flight conflict check so we don't waste a describe call.
    if (policy !== "overwrite") {
      const existing = await getContextItemByPath(conn, contextPath);
      if (existing) {
        if (policy === "skip") {
          logger.dim(`  ⊘ skipped (path exists): ${contextPath}`);
          return { kind: "skipped", contextPath };
        }
        return {
          kind: "conflict",
          contextPath,
          existingId: existing.id,
        };
      }
    }

    const bunFile = Bun.file(filePath);
    const mimeType = bunFile.type.split(";")[0] || "application/octet-stream";
    const filename = basename(filePath);
    const textual = isText(filename) !== false;
    const content = textual ? await bunFile.text() : null;

    const description =
      cachedDescription ??
      (await generateDescription(config, {
        filename,
        mimeType,
        content,
        filePath,
      }));

    const itemParams = {
      title: filename,
      description,
      content: content ?? undefined,
      mimeType,
      sourcePath: filePath,
      contextPath,
      isTextual: textual,
    } as const;

    const item =
      policy === "overwrite"
        ? await upsertContextItem(conn, itemParams)
        : await createContextItemStrict(conn, itemParams);

    return textual && content
      ? { kind: "added", id: item.id, contextPath: item.context_path }
      : null;
  } catch (err) {
    if (err instanceof PathConflictError) {
      // Race between pre-flight check and insert — still a conflict.
      return {
        kind: "conflict",
        contextPath,
        existingId: err.existingId,
      };
    }
    logger.warn(`  ! ${contextPath}: ${err}`);
    return { kind: "failed", contextPath, error: String(err) };
  }
}

/** Fetch a URL and upsert into context. */
type AddUrlResult =
  | { ok: true; id: string }
  | { ok: false; kind: "conflict"; existingId: string }
  | { ok: false; kind: "skipped" }
  | { ok: false; kind: "fetch-failed"; error: string; actionable: boolean };

async function addUrl(
  conn: DbConnection,
  config: Required<BotholomewConfig>,
  url: string,
  contextPath: string,
  mcpxClient: Awaited<ReturnType<typeof createMcpxClient>>,
  promptAddition: string | undefined,
  policy: ConflictPolicy,
): Promise<AddUrlResult> {
  // Pre-flight conflict check — skip the expensive fetch if we'd collide.
  if (policy !== "overwrite") {
    const existing = await getContextItemByPath(conn, contextPath);
    if (existing) {
      if (policy === "skip") return { ok: false, kind: "skipped" };
      return { ok: false, kind: "conflict", existingId: existing.id };
    }
  }

  try {
    const fetched = await fetchUrl(url, config, mcpxClient, promptAddition);

    const description = await generateDescription(config, {
      filename: new URL(url).hostname,
      mimeType: fetched.mimeType,
      content: fetched.content,
    });

    const itemParams = {
      title: fetched.title,
      description,
      content: fetched.content,
      mimeType: fetched.mimeType,
      sourceType: "url" as const,
      sourcePath: url,
      contextPath,
      isTextual: true,
    };

    const item =
      policy === "overwrite"
        ? await upsertContextItem(conn, itemParams)
        : await createContextItemStrict(conn, itemParams);

    return { ok: true, id: item.id };
  } catch (err) {
    if (err instanceof PathConflictError) {
      return { ok: false, kind: "conflict", existingId: err.existingId };
    }
    if (err instanceof FetchFailureError) {
      return {
        ok: false,
        kind: "fetch-failed",
        error: err.userMessage,
        actionable: true,
      };
    }
    return {
      ok: false,
      kind: "fetch-failed",
      error: String(err),
      actionable: false,
    };
  }
}

/**
 * Build a listing of every existing path (folders + files) to feed the LLM
 * placer. Seeing actual files in each folder helps the LLM place new content
 * alongside similar documents instead of inventing parallel folder names.
 */
async function renderExistingTree(conn: DbConnection): Promise<string> {
  const items = await listContextItems(conn);
  if (items.length === 0) return "";

  // Every implicit ancestor folder of every item.
  const folders = new Set<string>();
  for (const item of items) {
    const parts = item.context_path.split("/").filter(Boolean);
    const isExplicitDir = item.mime_type === "inode/directory";
    const folderDepth = isExplicitDir ? parts.length : parts.length - 1;
    for (let i = 1; i <= folderDepth; i++) {
      folders.add(`/${parts.slice(0, i).join("/")}/`);
    }
  }

  const files = items
    .filter((i) => i.mime_type !== "inode/directory")
    .map((i) => i.context_path);

  const all = [...folders, ...files].sort();
  const cap = 500;
  const truncated = all.slice(0, cap);
  const suffix =
    all.length > cap ? `\n  (+${all.length - cap} more entries)` : "";
  return truncated.map((p) => `  ${p}`).join("\n") + suffix;
}

/** Call the describer LLM to suggest a path + description for a file. */
async function suggestPathForFile(
  filePath: string,
  config: Required<BotholomewConfig>,
  existingTree: string,
): Promise<{ description: string; suggested_path: string } | null> {
  try {
    const bunFile = Bun.file(filePath);
    const mimeType = bunFile.type.split(";")[0] || "application/octet-stream";
    const filename = basename(filePath);
    const textual = isText(filename) !== false;
    const content = textual ? await bunFile.text() : null;
    return await generateDescriptionAndPath(config, {
      filename,
      mimeType,
      content,
      filePath,
      sourcePath: filePath,
      existingTree,
    });
  } catch {
    return null;
  }
}

/** Minimal stdin-based yes/no prompt, defaults to yes (empty input accepts). */
async function confirmYesNo(prompt: string): Promise<boolean> {
  process.stdout.write(prompt);
  return new Promise((resolvePromise) => {
    const onData = (chunk: Buffer) => {
      const line = chunk.toString().trim().toLowerCase();
      process.stdin.off("data", onData);
      process.stdin.pause();
      // Empty input (just Enter) or y/yes → accept; only n/no rejects.
      resolvePromise(line !== "n" && line !== "no");
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
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
