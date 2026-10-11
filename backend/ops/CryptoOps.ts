import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { config, ErrorType, TypedError } from "keryx";
// Type-only, purely for the `declare module "keryx"` augmentation inside.
// The frontend resolves action response types through the `@backend/*` alias, so
// its `tsc -b` type-checks this file too — and without this it would not know
// `config.secrets` exists. A *value* import would work for tsc and then fail
// `vite build`, by pulling keryx's runtime (and `import "bun"`) into the browser
// bundle. Type-only imports are the contract; values never cross.
import type {} from "../config/secrets";

/** The AEAD used for every credential this application encrypts at rest. */
const ALGORITHM = "aes-256-gcm";

/** AES-256 needs exactly this many bytes of key material. */
const KEY_BYTES = 32;

/** GCM's standard nonce length. Anything else costs a rehash of the IV. */
const IV_BYTES = 12;

/** An encrypted value, as stored across three columns of the table that holds it. */
export interface EncryptedSecret {
  /** Base64 ciphertext. */
  ciphertext: string;
  /** Base64 initialization vector — fresh random bytes for every encryption. */
  iv: string;
  /** Base64 GCM authentication tag. */
  authTag: string;
}

/**
 * Decode and validate the raw `SECRETS_ENCRYPTION_KEY`.
 *
 * Exported so it can be tested directly with a bad key, which the boot-time
 * check cannot be — by the time that throws, the process is already down.
 * @param raw - The base64 key from the environment.
 * @returns The 32 raw key bytes.
 * @throws {Error} If the key is absent, not base64, or not exactly 32 bytes.
 */
export function parseEncryptionKey(raw: string): Buffer {
  if (!raw || raw.trim() === "") {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY is not set. Credentials are encrypted with AES-256-GCM and cannot be stored without it. Generate one with: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes for AES-256-GCM, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }

  return key;
}

/** Memoized key material, so the base64 decode happens once per process. */
let cachedKey: Buffer | null = null;

/**
 * The process's encryption key.
 *
 * Memoized rather than resolved at import, because `config` is not populated
 * until `api.initialize()` runs and this module is imported long before that by
 * action discovery. The *eager* check — the one that must fail a misconfigured
 * deploy at boot rather than on somebody's first credential write hours later —
 * lives in `initializers/secrets.ts`, which calls this during `initialize()`.
 *
 * There is deliberately no plaintext fallback anywhere in this file. A silent
 * one would put unencrypted API keys in Postgres and report success.
 * @returns The 32 raw key bytes.
 * @throws {Error} If `SECRETS_ENCRYPTION_KEY` is absent or not 32 bytes.
 */
export function getEncryptionKey(): Buffer {
  cachedKey ??= parseEncryptionKey(config.secrets.encryptionKey);
  return cachedKey;
}

/**
 * Encrypt a secret with AES-256-GCM under a fresh random IV.
 * @param plaintext - The value to protect.
 * @returns The base64 ciphertext, IV, and authentication tag.
 */
export function encryptSecret(plaintext: string): EncryptedSecret {
  return encryptBytes(Buffer.from(plaintext, "utf8"));
}

/**
 * Encrypt raw bytes with AES-256-GCM under a fresh random IV.
 *
 * A binary value (a gzipped bundle, say) cannot go through
 * {@link encryptSecret}'s UTF-8 encoding. The stored triple is the same shape
 * either way.
 * @param plaintext - The bytes to protect.
 * @returns The base64 ciphertext, IV, and authentication tag.
 */
export function encryptBytes(plaintext: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypt a value produced by {@link encryptSecret}.
 *
 * GCM authenticates as it decrypts, so a tampered ciphertext, IV, or tag fails
 * here rather than returning garbage — which is the reason for choosing an AEAD
 * over plain CBC for a column an operator can edit with `psql`.
 * @param record - The stored ciphertext, IV, and authentication tag.
 * @returns The plaintext.
 * @throws {TypedError} `CONNECTION_ACTION_RUN` if authentication fails, which
 *   means the row was tampered with or the encryption key changed.
 */
export function decryptSecret(record: EncryptedSecret): string {
  return decryptBytes(record).toString("utf8");
}

/**
 * Decrypt a value produced by {@link encryptBytes}.
 *
 * GCM authenticates as it decrypts, so a tampered ciphertext, IV, or tag
 * fails here rather than returning garbage.
 * @param record - The stored ciphertext, IV, and authentication tag.
 * @returns The plaintext bytes.
 * @throws {TypedError} `CONNECTION_ACTION_RUN` if authentication fails.
 */
export function decryptBytes(record: EncryptedSecret): Buffer {
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getEncryptionKey(),
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch (_e) {
    throw new TypedError({
      message:
        "Could not decrypt this secret. It was either tampered with, or SECRETS_ENCRYPTION_KEY has changed since it was stored.",
      type: ErrorType.CONNECTION_ACTION_RUN,
    });
  }
}

/**
 * The last four characters of a secret, the only part of it any API ever
 * returns. Values shorter than eight characters report nothing rather than most
 * of themselves — a four-character "hint" on a six-character value is the value.
 * @param plaintext - The secret.
 * @returns The last four characters, or an empty string for a short secret.
 */
export function lastFourOf(plaintext: string): string {
  return plaintext.length >= 8 ? plaintext.slice(-4) : "";
}

/**
 * Constant-time comparison for two secrets of the same kind (a token against
 * its stored hash, say). Length differences short-circuit — they are not secret
 * — but equal-length values are compared without an early exit.
 * @param a - The first value.
 * @param b - The second value.
 * @returns Whether they are identical.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
