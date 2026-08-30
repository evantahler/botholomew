import { RunError } from "run";

export const HOST_ERROR_TYPES = [
  "source_not_found",
  "source_too_large",
  "invalid_json",
  "write_failed",
  "mcp_error",
  "host_error",
] as const;

export type HostErrorType = (typeof HOST_ERROR_TYPES)[number];

const HINTS: Record<HostErrorType, string> = {
  source_not_found:
    "Call files.list or files.search to find the right logical_path, then retry.",
  source_too_large:
    "Narrow the data at the source, raise max_input_bytes, or use mcp.capture and reduce a smaller slice.",
  invalid_json:
    "files.readJson only works on JSON. Use files.readText for plain text, and confirm the logical_path.",
  write_failed:
    "Check the destination logical_path and retry the write. The transform itself may have succeeded.",
  mcp_error:
    "Use mcp.info to confirm the server, tool, and arguments, then retry. Capture large payloads with mcp.capture.",
  host_error: "Simplify the program or the host call and retry.",
};

/**
 * Thrown from a host function so Run preserves `code` + `message` across the
 * sandbox boundary (plain Errors are rewritten as "Host function failed.").
 */
export class HostOpError extends RunError {
  constructor(type: HostErrorType, message: string) {
    super(message, type);
    this.name = type;
  }
}

export function isHostErrorType(code: string): code is HostErrorType {
  return (HOST_ERROR_TYPES as readonly string[]).includes(code);
}

export function hintForHostError(type: HostErrorType): string {
  return HINTS[type];
}
