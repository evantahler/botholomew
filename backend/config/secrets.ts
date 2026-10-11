import { loadFromEnvIfSet } from "keryx";

/**
 * The key material behind every credential this application encrypts at rest.
 *
 * Nothing is encrypted with it yet: no table holds a credential. The boot check
 * in `ops/CryptoOps.ts` runs anyway, so a deployment's key is proven valid from
 * its first boot rather than at the first write that needs it.
 *
 * Deliberately raw here — this module only reads the environment. Validation
 * (base64, exactly 32 bytes) lives in `ops/CryptoOps.ts`, which runs it at
 * import time, so a bad key fails at boot rather than at the first encryption.
 * Splitting it this way avoids a cycle: `CryptoOps` reads `config.secrets`, so
 * `config.secrets` cannot import `CryptoOps`.
 *
 * In the deployed blueprint this comes from the `botholomew-shared` env var group,
 * not from either service directly: `generateValue: true` declared on both web
 * and worker mints two different keys, and anything the web service encrypted
 * would then be undecryptable in a worker task.
 */
export const configSecrets = {
  encryptionKey: await loadFromEnvIfSet("SECRETS_ENCRYPTION_KEY", ""),
};

declare module "keryx" {
  interface KeryxConfig {
    secrets: typeof configSecrets;
  }
}
