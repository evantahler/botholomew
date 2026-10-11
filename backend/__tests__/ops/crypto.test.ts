import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api } from "keryx";
import {
  decryptSecret,
  encryptSecret,
  lastFourOf,
  parseEncryptionKey,
  secretsMatch,
} from "../../ops/CryptoOps";
import { HOOK_TIMEOUT } from "../setup";

// The cipher functions read the key off `config.secrets`, which keryx does not
// populate until `api.initialize()` — so even a test this close to a pure unit
// test has to boot. That indirection is deliberate: it is what lets
// `SECRETS_ENCRYPTION_KEY_TEST` select itself under `NODE_ENV=test`.
beforeAll(async () => {
  await api.start();
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("parseEncryptionKey", () => {
  test("accepts a base64 32-byte key", () => {
    const key = parseEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
    expect(key.length).toBe(32);
  });

  test("throws when the key is missing", () => {
    expect(() => parseEncryptionKey("")).toThrow(/SECRETS_ENCRYPTION_KEY/);
    expect(() => parseEncryptionKey("   ")).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });

  test("throws when the key is the wrong length", () => {
    // A 16-byte key would silently give AES-128 in a scheme documented as
    // AES-256, which is exactly the kind of quiet downgrade this rejects.
    expect(() =>
      parseEncryptionKey(Buffer.alloc(16, 1).toString("base64")),
    ).toThrow(/exactly 32 bytes/);
    expect(() =>
      parseEncryptionKey(Buffer.alloc(64, 1).toString("base64")),
    ).toThrow(/exactly 32 bytes/);
  });
});

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a value", () => {
    const plaintext = "sk-ant-api03-not-a-real-key-000000";
    const encrypted = encryptSecret(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  test("round-trips unicode and long values", () => {
    const plaintext = `🔐 ${"a".repeat(10_000)} — ünïcødé`;
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  test("never emits the plaintext in any stored field", () => {
    const plaintext = "super-secret-value";
    const encrypted = encryptSecret(plaintext);
    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain(plaintext);
    expect(
      Buffer.from(encrypted.ciphertext, "base64").toString("utf8"),
    ).not.toBe(plaintext);
  });

  test("uses a fresh IV, so the same value encrypts differently every time", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test("a tampered auth tag fails to decrypt", () => {
    const encrypted = encryptSecret("sk-ant-tampered");
    const tag = Buffer.from(encrypted.authTag, "base64");
    tag[0] ^= 0xff;

    expect(() =>
      decryptSecret({ ...encrypted, authTag: tag.toString("base64") }),
    ).toThrow(/Could not decrypt/);
  });

  test("a tampered ciphertext fails to decrypt rather than returning garbage", () => {
    // The whole reason for choosing an AEAD over CBC: this column is editable
    // with psql, and a silently-mangled API key is far worse than an error.
    const encrypted = encryptSecret("sk-ant-original");
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] ^= 0xff;

    expect(() =>
      decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") }),
    ).toThrow(/Could not decrypt/);
  });

  test("a value encrypted under a different key fails to decrypt", () => {
    const encrypted = encryptSecret("sk-ant-key-rotation");
    // Swapping the IV for another encryption's is the cheapest stand-in for a
    // key change: GCM authenticates the IV, so it fails the same way.
    const other = encryptSecret("something-else");
    expect(() => decryptSecret({ ...encrypted, iv: other.iv })).toThrow(
      /Could not decrypt/,
    );
  });
});

describe("lastFourOf", () => {
  test("returns the last four characters of a long enough value", () => {
    expect(lastFourOf("sk-ant-api03-abcd1234")).toBe("1234");
  });

  test("returns nothing for a short value", () => {
    // Four of six characters is not a hint, it is most of the secret.
    expect(lastFourOf("abcdef")).toBe("");
    expect(lastFourOf("")).toBe("");
  });
});

describe("secretsMatch", () => {
  test("compares equal values as equal and different ones as different", () => {
    expect(secretsMatch("token-abc", "token-abc")).toBe(true);
    expect(secretsMatch("token-abc", "token-abd")).toBe(false);
    expect(secretsMatch("short", "much-longer-value")).toBe(false);
  });
});
