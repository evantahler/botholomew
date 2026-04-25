import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { isText } from "istextorbinary";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import { generateDescription } from "../context/describer.ts";
import {
  type DriveTarget,
  detectDriveFromUrl,
  formatDriveRef,
  parseDriveRef,
} from "../context/drives.ts";
import { embedSingle } from "../context/embedder.ts";
import { FetchFailureError, fetchUrl } from "../context/fetcher.ts";
import {
  type PreparedIngestion,
  prepareIngestion,
  storeIngestion,
} from "../context/ingest.ts";
import { refreshContextItems } from "../context/refresh.ts";
import { isUrl } from "../context/url-utils.ts";
import type { DbConnection } from "../db/connection.ts";
import {
  type ContextItem,
  createContextItemStrict,
  deleteContextItemByPath,
  getContextItem,
  getDistinctDirectories,
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
    .option("--drive <drive>", "filter by drive (e.g. disk, url, agent)")
    .option("--path <prefix>", "filter by path prefix (requires --drive)")
    .option(
      "--non-recursive",
      "list only immediate children; include directories",
    )
    .option("-l, --limit <n>", "max number of items", Number.parseInt)
    .option("-o, --offset <n>", "skip first N items", Number.parseInt)
    .action((opts) =>
      withDb(program, async (conn) => {
        if (opts.path && !opts.drive) {
          logger.error("--path requires --drive to scope the prefix.");
          process.exit(1);
        }
        if (opts.nonRecursive && !opts.drive) {
          logger.error(
            "--non-recursive requires --drive to scope the listing.",
          );
          process.exit(1);
        }

        const prefix = opts.path ?? (opts.nonRecursive ? "/" : null);
        const items = prefix
          ? await listContextItemsByPrefix(conn, opts.drive, prefix, {
              recursive: !opts.nonRecursive,
              limit: opts.limit,
              offset: opts.offset,
            })
          : await listContextItems(conn, {
              drive: opts.drive,
              limit: opts.limit,
              offset: opts.offset,
            });

        const dirs = opts.nonRecursive
          ? await getDistinctDirectories(conn, opts.drive, opts.path ?? "/")
          : [];

        if (items.length === 0 && dirs.length === 0) {
          logger.dim("No context entries found.");
          return;
        }

        const header = `${ansis.bold("ID".padEnd(36))} ${ansis.bold("Ref".padEnd(50))} ${"Title".padEnd(20)} ${"Description".padEnd(30)} ${"Type".padEnd(15)} ${"Updated".padEnd(18)} Indexed`;
        console.log(header);
        console.log("-".repeat(header.length));

        const dash = ansis.dim("—");
        for (const dir of dirs) {
          const ref = formatDriveRef({ drive: opts.drive, path: `${dir}/` });
          console.log(
            `${dash.padEnd(36)} ${ansis.cyan(ref.slice(0, 49).padEnd(50))} ${dash.padEnd(20)} ${dash.padEnd(30)} ${ansis.dim("directory".padEnd(15))} ${dash.padEnd(18)} ${dash}`,
          );
        }

        for (const item of items) {
          const indexed = item.indexed_at
            ? ansis.green("yes")
            : ansis.dim("no");
          const updated = ansis.dim(fmtDate(item.updated_at).padEnd(18));
          const desc = item.description
            ? ansis.dim(item.description.slice(0, 29).padEnd(30))
            : ansis.dim("".padEnd(30));
          const id = ansis.dim(item.id.padEnd(36));
          const ref = formatDriveRef(item);
          console.log(
            `${id} ${ref.slice(0, 49).padEnd(50)} ${item.title.slice(0, 19).padEnd(20)} ${desc} ${item.mime_type.slice(0, 14).padEnd(15)} ${updated} ${indexed}`,
          );
        }

        const totals: string[] = [];
        if (dirs.length > 0) {
          totals.push(`${dirs.length} dir(s)`);
        }
        totals.push(`${items.length} item(s)`);
        console.log(`\n${ansis.dim(totals.join(", "))}`);
      }),
    );

  ctx
    .command("add <paths...>")
    .description("Add files, directories, or URLs to context")
    .option(
      "--on-conflict <policy>",
      "collision policy: error | overwrite | skip",
      "skip",
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

        type FileToAdd = { filePath: string; target: DriveTarget };
        type UrlToAdd = { url: string; target: DriveTarget | null };
        const filesToAdd: FileToAdd[] = [];
        const urlsToAdd: UrlToAdd[] = [];
        const spinner = createSpinner("Scanning paths...").start();

        for (const path of paths) {
          if (isUrl(path)) {
            // We defer drive detection until after the fetch — the MCP server
            // name is a useful hint — but pre-compute a best-guess from the URL
            // alone for dedup against existing (drive, path) rows.
            urlsToAdd.push({
              url: path,
              target: detectDriveFromUrl(path),
            });
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
                filesToAdd.push({
                  filePath,
                  target: { drive: "disk", path: filePath },
                });
              }
            } else {
              filesToAdd.push({
                filePath: resolvedPath,
                target: { drive: "disk", path: resolvedPath },
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

        // Phase 0: (drive, path) dedup — items already in context are routed
        // per --on-conflict before we pay for the describe or fetch.
        type AlreadyInContext = {
          target: DriveTarget;
          existing: ContextItem;
        };
        const alreadyInContext: AlreadyInContext[] = [];
        const remainingFiles: FileToAdd[] = [];
        const remainingUrls: UrlToAdd[] = [];

        for (const f of filesToAdd) {
          const existing = await getContextItem(conn, f.target);
          if (existing) {
            alreadyInContext.push({ target: f.target, existing });
          } else {
            remainingFiles.push(f);
          }
        }
        for (const u of urlsToAdd) {
          if (!u.target) {
            remainingUrls.push(u);
            continue;
          }
          const existing = await getContextItem(conn, u.target);
          if (existing) {
            alreadyInContext.push({ target: u.target, existing });
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
              `${alreadyInContext.length} item(s) already in context:`,
            );
            for (const a of alreadyInContext) {
              console.log(
                `  ${ansis.red("✗")} ${formatDriveRef(a.target)} (id: ${a.existing.id})`,
              );
            }
            logger.dim(
              "Re-run with --on-conflict=skip to ignore these items or --on-conflict=overwrite to refresh them.",
            );
            process.exit(1);
          }

          if (policy === "skip") {
            for (const a of alreadyInContext) {
              logger.dim(`⊘ already in context: ${formatDriveRef(a.target)}`);
              dedupSkipped.push(formatDriveRef(a.target));
            }
          } else {
            const itemsToRefresh = alreadyInContext.map((a) => a.existing);
            const hasUrls = itemsToRefresh.some((i) => i.drive !== "disk");
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

            refreshedCount = refreshResult.updated + refreshResult.unchanged;
            refreshedChunks = refreshResult.chunks;
            for (const item of refreshResult.items) {
              if (item.status === "missing") {
                logger.warn(`  Missing: ${item.ref}`);
              } else if (item.status === "error") {
                logger.warn(`  Error refreshing ${item.ref}: ${item.error}`);
              }
            }
          }
        }

        // Phase 1: Upsert DB records (batched, parallel LLM descriptions)
        let addCompleted = 0;
        const itemIds: { id: string; target: DriveTarget }[] = [];
        const conflicts: { target: DriveTarget; existingId: string }[] = [];
        const skipped: string[] = [];

        if (remainingFiles.length > 0) {
          const fileSpinner = createSpinner(
            `Adding and describing 0/${remainingFiles.length} file(s)...`,
          ).start();

          for (let i = 0; i < remainingFiles.length; i += CONCURRENCY) {
            const batch = remainingFiles.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async ({ filePath, target }) => {
                const result = await addFile(
                  conn,
                  filePath,
                  target,
                  config,
                  policy,
                );
                addCompleted++;
                fileSpinner.update({
                  text: `Adding and describing ${addCompleted}/${remainingFiles.length} file(s)...`,
                });
                return result;
              }),
            );
            for (const r of results) {
              if (!r) continue;
              if (r.kind === "added") {
                itemIds.push({ id: r.id, target: r.target });
              } else if (r.kind === "conflict") {
                conflicts.push({ target: r.target, existingId: r.existingId });
              } else if (r.kind === "skipped") {
                skipped.push(formatDriveRef(r.target));
              }
            }
          }

          fileSpinner.success({
            text: `Added and described ${addCompleted} file(s).`,
          });
        }

        if (remainingUrls.length > 0) {
          const mcpxClient = await createMcpxClient(dir);
          if (!mcpxClient) {
            logger.dim(
              "No MCP servers configured — remote fetches will use basic HTTP.",
            );
          }

          let urlIdx = 0;
          let urlAdded = 0;
          for (const { url } of remainingUrls) {
            urlIdx++;
            console.log(
              `\n${ansis.bold(`[${urlIdx}/${remainingUrls.length}]`)} ${ansis.cyan(url)}`,
            );
            const result = await addUrl(
              conn,
              config,
              url,
              mcpxClient,
              opts.promptAddition,
              policy,
            );
            if (result.ok) {
              urlAdded++;
              itemIds.push({ id: result.id, target: result.target });
              console.log(
                `  ${ansis.green("✔")} stored at ${formatDriveRef(result.target)}`,
              );
            } else if (result.kind === "conflict") {
              conflicts.push({
                target: result.target,
                existingId: result.existingId,
              });
              console.log(
                `  ${ansis.red("✗")} path already exists: ${formatDriveRef(result.target)}`,
              );
            } else if (result.kind === "skipped") {
              skipped.push(formatDriveRef(result.target));
              console.log(
                `  ${ansis.yellow("⊘")} skipped (path exists): ${formatDriveRef(result.target)}`,
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

          const urlSummary = `Added ${urlAdded}/${remainingUrls.length} URL(s).`;
          if (urlAdded === remainingUrls.length) {
            console.log(`\n${ansis.green("✔")} ${urlSummary}`);
          } else if (urlAdded === 0) {
            console.log(`\n${ansis.red("✗")} ${urlSummary}`);
          } else {
            console.log(`\n${ansis.yellow("⚠")} ${urlSummary}`);
          }
        }

        if (conflicts.length > 0) {
          logger.error(
            `${conflicts.length} (drive, path) collision(s) — nothing written for these items:`,
          );
          for (const c of conflicts) {
            console.log(
              `  ${ansis.red("✗")} ${formatDriveRef(c.target)} (existing id: ${c.existingId})`,
            );
          }
        }

        skipped.push(...dedupSkipped);

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
          const ref =
            r.drive && r.path
              ? formatDriveRef({ drive: r.drive, path: r.path })
              : r.context_item_id;
          console.log(
            `   ${ansis.dim(ref)}  ${ansis.dim(fmtDate(r.created_at))}`,
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
    .command("delete <ref>")
    .description("Delete a context entry (UUID or drive:/path)")
    .action((ref: string) =>
      withDb(program, async (conn) => {
        const item = await resolveContextItem(conn, ref);
        if (!item) {
          logger.error(`Context entry not found: ${ref}`);
          process.exit(1);
        }
        await deleteContextItemByPath(conn, {
          drive: item.drive,
          path: item.path,
        });
        logger.success(`Deleted context entry: ${formatDriveRef(item)}`);
      }),
    );
  ctx
    .command("chunks <ref>")
    .description("Show chunks and embeddings for a context entry")
    .action((ref: string) =>
      withDb(program, async (conn) => {
        const item = await resolveContextItem(conn, ref);
        if (!item) {
          logger.error(`Context entry not found: ${ref}`);
          process.exit(1);
        }

        if (!item.indexed_at) {
          logger.dim("Item has not been indexed yet.");
          return;
        }

        const embeddings = await getEmbeddingsForItem(conn, item.id);

        console.log(ansis.bold(item.title));
        console.log(`  Ref:       ${formatDriveRef(item)}`);
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
    .command("refresh [refs...]")
    .description(
      "Re-import items from their origin (disk / URL / MCP) and re-embed if content changed",
    )
    .option("--all", "refresh every item (except those on drive=agent)")
    .action((refs: string[], opts: { all?: boolean }) =>
      withDb(program, async (conn, dir) => {
        const items = await resolveItems(conn, refs, !!opts.all);
        if (items.length === 0) {
          logger.error("No matching context entries found.");
          process.exit(1);
        }

        const refreshable = items.filter((i) => i.drive !== "agent");
        if (refreshable.length === 0) {
          logger.dim("No refreshable items (everything is on drive=agent).");
          return;
        }
        if (refreshable.length < items.length) {
          logger.dim(
            `Skipping ${items.length - refreshable.length} agent-drive item(s) with no external origin.`,
          );
        }

        const config = await loadConfig(dir);

        const hasUrls = refreshable.some((i) => i.drive !== "disk");
        const mcpxClient = hasUrls ? await createMcpxClient(dir) : null;

        const refreshSpinner = createSpinner(
          `Refreshing 0/${refreshable.length} items...`,
        ).start();
        const embedSpinner = createSpinner("Embedding 0 item(s)...");

        const result = await refreshContextItems(
          conn,
          refreshable,
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
            logger.warn(`  Missing: ${item.ref}`);
          } else if (item.status === "error") {
            logger.warn(`  Error refreshing ${item.ref}: ${item.error}`);
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

  registerContextToolSubcommands(ctx);
}

async function resolveItems(
  conn: DbConnection,
  refs: string[],
  all: boolean,
): Promise<ContextItem[]> {
  if (!all && refs.length === 0) {
    logger.error("Provide at least one ref or use --all.");
    process.exit(1);
  }
  if (all) return listContextItems(conn);

  const byId = new Map<string, ContextItem>();
  const unresolved: string[] = [];
  for (const r of refs) {
    const matched = await resolveOne(conn, r);
    if (matched.length === 0) {
      unresolved.push(r);
      continue;
    }
    for (const item of matched) byId.set(item.id, item);
  }
  for (const r of unresolved) logger.warn(`  Not found: ${r}`);
  return [...byId.values()];
}

async function resolveOne(
  conn: DbConnection,
  ref: string,
): Promise<ContextItem[]> {
  const exact = await resolveContextItem(conn, ref);
  if (exact) return [exact];
  // Prefix expansion: only valid for `drive:/path` form.
  const parsed = parseDriveRef(ref);
  if (parsed) {
    return listContextItemsByPrefix(conn, parsed.drive, parsed.path, {
      recursive: true,
    });
  }
  return [];
}

type ConflictPolicy = "error" | "overwrite" | "skip";

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
  | { kind: "added"; id: string; target: DriveTarget }
  | { kind: "skipped"; target: DriveTarget }
  | { kind: "conflict"; target: DriveTarget; existingId: string }
  | { kind: "failed"; target: DriveTarget; error: string };

async function addFile(
  conn: DbConnection,
  filePath: string,
  target: DriveTarget,
  config: Required<BotholomewConfig>,
  policy: ConflictPolicy,
): Promise<AddFileResult | null> {
  try {
    if (policy !== "overwrite") {
      const existing = await getContextItem(conn, target);
      if (existing) {
        if (policy === "skip") {
          logger.dim(`  ⊘ skipped (exists): ${formatDriveRef(target)}`);
          return { kind: "skipped", target };
        }
        return {
          kind: "conflict",
          target,
          existingId: existing.id,
        };
      }
    }

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

    const itemParams = {
      title: filename,
      description,
      content: content ?? undefined,
      mimeType,
      drive: target.drive,
      path: target.path,
      isTextual: textual,
    } as const;

    const item =
      policy === "overwrite"
        ? await upsertContextItem(conn, itemParams)
        : await createContextItemStrict(conn, itemParams);

    return textual && content ? { kind: "added", id: item.id, target } : null;
  } catch (err) {
    if (err instanceof PathConflictError) {
      return { kind: "conflict", target, existingId: err.existingId };
    }
    logger.warn(`  ! ${formatDriveRef(target)}: ${err}`);
    return { kind: "failed", target, error: String(err) };
  }
}

type AddUrlResult =
  | { ok: true; id: string; target: DriveTarget }
  | { ok: false; kind: "conflict"; target: DriveTarget; existingId: string }
  | { ok: false; kind: "skipped"; target: DriveTarget }
  | { ok: false; kind: "fetch-failed"; error: string; actionable: boolean };

async function addUrl(
  conn: DbConnection,
  config: Required<BotholomewConfig>,
  url: string,
  mcpxClient: Awaited<ReturnType<typeof createMcpxClient>>,
  promptAddition: string | undefined,
  policy: ConflictPolicy,
): Promise<AddUrlResult> {
  try {
    const fetched = await fetchUrl(url, config, mcpxClient, promptAddition);
    const target: DriveTarget = { drive: fetched.drive, path: fetched.path };

    if (policy !== "overwrite") {
      const existing = await getContextItem(conn, target);
      if (existing) {
        if (policy === "skip") return { ok: false, kind: "skipped", target };
        return { ok: false, kind: "conflict", target, existingId: existing.id };
      }
    }

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
      drive: target.drive,
      path: target.path,
      isTextual: true,
      sourceUrl: fetched.sourceUrl,
    };

    const item =
      policy === "overwrite"
        ? await upsertContextItem(conn, itemParams)
        : await createContextItemStrict(conn, itemParams);

    return { ok: true, id: item.id, target };
  } catch (err) {
    if (err instanceof PathConflictError) {
      return {
        ok: false,
        kind: "conflict",
        target: { drive: err.drive, path: err.path },
        existingId: err.existingId,
      };
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
