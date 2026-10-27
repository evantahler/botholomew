export const DEFAULT_LOG_TAIL_BYTES = 128 * 1024;

export interface LogTail {
  content: string;
  truncated: boolean;
  size: number;
}

/**
 * Read the tail of a worker log file. Returns at most `maxBytes` from the end
 * of the file; sets `truncated` when the file is larger than that.
 *
 * If the file doesn't exist (worker hasn't written anything yet), returns
 * empty content rather than throwing — the caller renders an empty-state
 * message instead of an error.
 */
export async function readLogTail(
  logPath: string,
  maxBytes = DEFAULT_LOG_TAIL_BYTES,
): Promise<LogTail> {
  const file = Bun.file(logPath);
  if (!(await file.exists())) {
    return { content: "", truncated: false, size: 0 };
  }
  const size = file.size;
  if (size === 0) {
    return { content: "", truncated: false, size: 0 };
  }
  if (size <= maxBytes) {
    return { content: await file.text(), truncated: false, size };
  }
  const start = size - maxBytes;
  const content = await file.slice(start, size).text();
  return { content, truncated: true, size };
}
