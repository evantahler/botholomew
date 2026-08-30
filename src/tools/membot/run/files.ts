import { isHelpfulError } from "membot";
import type { ToolContext } from "../../tool.ts";
import { HostOpError } from "./errors.ts";
import {
  DEFAULT_MAX_INPUT_BYTES,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_HIT_CAP,
} from "./limits.ts";

export interface FilesHostOptions {
  maxInputBytes: number;
}

function requirePath(logicalPath: unknown): string {
  if (typeof logicalPath !== "string" || logicalPath.trim() === "") {
    throw new HostOpError(
      "host_error",
      "logicalPath must be a non-empty string.",
    );
  }
  return logicalPath;
}

async function readContent(
  ctx: ToolContext,
  logicalPath: string,
  maxInputBytes: number,
): Promise<string> {
  try {
    const read = await ctx.withMem((mem) =>
      mem.read({ logical_path: logicalPath }),
    );
    const content = read.content ?? "";
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxInputBytes) {
      throw new HostOpError(
        "source_too_large",
        `Source is ${bytes} bytes, exceeding max_input_bytes (${maxInputBytes}).`,
      );
    }
    return content;
  } catch (err) {
    if (err instanceof HostOpError) throw err;
    if (isHelpfulError(err)) {
      throw new HostOpError("source_not_found", err.message);
    }
    throw new HostOpError(
      "host_error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function writeContent(
  ctx: ToolContext,
  logicalPath: string,
  content: string,
  changeNote?: string,
): Promise<{ logical_path: string; version_id: string; size_bytes: number }> {
  try {
    const written = await ctx.withMem((mem) =>
      mem.write({
        logical_path: logicalPath,
        content,
        change_note: changeNote,
      }),
    );
    return {
      logical_path: written.logical_path,
      version_id: written.version_id,
      size_bytes: written.size_bytes,
    };
  } catch (err) {
    if (isHelpfulError(err)) {
      throw new HostOpError("write_failed", err.message);
    }
    throw new HostOpError(
      "write_failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function createFilesHost(ctx: ToolContext, opts: FilesHostOptions) {
  const maxInputBytes = opts.maxInputBytes || DEFAULT_MAX_INPUT_BYTES;
  return {
    readJson: async (logicalPath: unknown) => {
      const path = requirePath(logicalPath);
      const content = await readContent(ctx, path, maxInputBytes);
      try {
        return JSON.parse(content);
      } catch (err) {
        throw new HostOpError(
          "invalid_json",
          `Source at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    readText: async (logicalPath: unknown) => {
      return readContent(ctx, requirePath(logicalPath), maxInputBytes);
    },
    writeJson: async (
      logicalPath: unknown,
      value: unknown,
      changeNote?: unknown,
    ) => {
      const path = requirePath(logicalPath);
      const note = typeof changeNote === "string" ? changeNote : undefined;
      const body = JSON.stringify(value ?? null, null, 2);
      return writeContent(ctx, path, body, note);
    },
    writeText: async (
      logicalPath: unknown,
      content: unknown,
      changeNote?: unknown,
    ) => {
      const path = requirePath(logicalPath);
      if (typeof content !== "string") {
        throw new HostOpError("host_error", "content must be a string.");
      }
      const note = typeof changeNote === "string" ? changeNote : undefined;
      return writeContent(ctx, path, content, note);
    },
    exists: async (logicalPath: unknown) => {
      const path = requirePath(logicalPath);
      try {
        await ctx.withMem((mem) => mem.info({ logical_path: path }));
        return true;
      } catch (err) {
        if (isHelpfulError(err) && err.kind === "not_found") return false;
        if (isHelpfulError(err)) {
          throw new HostOpError("host_error", err.message);
        }
        throw new HostOpError(
          "host_error",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    info: async (logicalPath: unknown) => {
      const path = requirePath(logicalPath);
      try {
        const info = await ctx.withMem((mem) =>
          mem.info({ logical_path: path }),
        );
        return {
          logical_path: info.logical_path,
          source_path: info.source_path,
          mime_type: info.mime_type,
          size_bytes: info.size_bytes,
          version_id: info.version_id,
          last_refresh_status: info.last_refresh_status,
        };
      } catch (err) {
        if (isHelpfulError(err)) {
          throw new HostOpError("source_not_found", err.message);
        }
        throw new HostOpError(
          "host_error",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    list: async (options?: unknown) => {
      const optsIn =
        options && typeof options === "object"
          ? (options as {
              prefix?: unknown;
              limit?: unknown;
              offset?: unknown;
            })
          : {};
      const prefix =
        typeof optsIn.prefix === "string" ? optsIn.prefix : undefined;
      const offset =
        typeof optsIn.offset === "number" && optsIn.offset >= 0
          ? Math.floor(optsIn.offset)
          : 0;
      let limit = LIST_DEFAULT_LIMIT;
      if (typeof optsIn.limit === "number" && optsIn.limit > 0) {
        limit = Math.min(Math.floor(optsIn.limit), LIST_MAX_LIMIT);
      }
      try {
        return await ctx.withMem((mem) => mem.list({ prefix, limit, offset }));
      } catch (err) {
        throw new HostOpError(
          "host_error",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    search: async (query: unknown, options?: unknown) => {
      if (typeof query !== "string" || query.trim() === "") {
        throw new HostOpError(
          "host_error",
          "query must be a non-empty string.",
        );
      }
      const optsIn =
        options && typeof options === "object"
          ? (options as { limit?: unknown; path_prefix?: unknown })
          : {};
      let limit = SEARCH_DEFAULT_LIMIT;
      if (typeof optsIn.limit === "number" && optsIn.limit > 0) {
        limit = Math.min(Math.floor(optsIn.limit), SEARCH_HIT_CAP);
      }
      const pathPrefix =
        typeof optsIn.path_prefix === "string" ? optsIn.path_prefix : undefined;
      try {
        const result = await ctx.withMem((mem) =>
          mem.search({
            query,
            pattern: query,
            path_prefix: pathPrefix,
            limit,
          }),
        );
        return {
          hits: result.hits.slice(0, SEARCH_HIT_CAP).map((hit) => ({
            logical_path: hit.logical_path,
            score: hit.score,
            snippet: hit.snippet,
          })),
        };
      } catch (err) {
        throw new HostOpError(
          "host_error",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
