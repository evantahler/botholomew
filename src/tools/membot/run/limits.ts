import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRunner, type RunLimits, type Runner } from "run";
import { getApprovalsDir } from "../../../constants.ts";
import { atomicWrite } from "../../../fs/atomic.ts";

/** Default ceiling on a single files.readJson / files.readText, in characters. */
export const DEFAULT_MAX_INPUT_BYTES = 20_000_000;

export const PREVIEW_CHARS = 200;

export const SEARCH_HIT_CAP = 20;
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;

export const CONTINUATION_AUDIENCE = "botholomew-membot-run-v1";

export const RUN_LIMITS: RunLimits = {
  timeoutMs: 30_000,
  memoryLimitBytes: 96 * 1024 * 1024,
  maxStackSizeBytes: 2 * 1024 * 1024,
  maxResultBytes: 1024 * 1024,
  maxConsoleOutputBytes: 64 * 1024,
  maxSourceBytes: 256 * 1024,
  maxHostFunctionArgumentsBytes: 22 * 1024 * 1024,
  maxHostFunctionOutputBytes: 22 * 1024 * 1024,
  maxBridgeRequests: 256,
  maxInFlightBridgeRequests: 32,
  maxContinuationBytes: 32 * 1024 * 1024,
};

const SECRET_FILENAME = ".continuation-secret";

export function continuationSecretPath(projectDir: string): string {
  return join(getApprovalsDir(projectDir), SECRET_FILENAME);
}

export async function loadOrCreateContinuationSecret(
  projectDir: string,
): Promise<Uint8Array> {
  const path = continuationSecretPath(projectDir);
  try {
    const buf = Buffer.from(await Bun.file(path).bytes());
    if (buf.byteLength >= 32) return new Uint8Array(buf);
  } catch {
    // create below
  }
  await mkdir(getApprovalsDir(projectDir), { recursive: true });
  const secret = randomBytes(32);
  await atomicWrite(path, secret);
  return new Uint8Array(secret);
}

export async function createProjectRunner(projectDir: string): Promise<Runner> {
  return createRunner({
    limits: RUN_LIMITS,
    continuationSecret: await loadOrCreateContinuationSecret(projectDir),
    continuationAudience: CONTINUATION_AUDIENCE,
  });
}
