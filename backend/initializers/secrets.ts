import { Initializer, logger } from "keryx";
import { getEncryptionKey } from "../ops/CryptoOps";

const namespace = "secretsKey";

/**
 * Fail the boot if `SECRETS_ENCRYPTION_KEY` is missing or the wrong length.
 *
 * The alternative — checking lazily, on the first credential write — turns a
 * misconfigured deploy into a failure that surfaces hours later, to whichever
 * admin happened to try storing a credential, with an error that reads like
 * their fault. Failing here means a bad key is a failed deploy, which is what it
 * actually is.
 *
 * `declaresAPIProperty = false`: this initializer attaches nothing to `api`, it
 * only asserts. That is a legitimate shape, and the framework validates the flag.
 */
export class Secrets extends Initializer {
  /** Register the boot-time encryption-key check; it attaches nothing to `api`. */
  constructor() {
    super(namespace);
    this.declaresAPIProperty = false;
  }

  /**
   * Resolve and validate the encryption key, memoizing it for the process.
   * @throws {Error} If the key is absent or does not decode to 32 bytes.
   */
  async initialize() {
    const key = getEncryptionKey();
    logger.debug(
      `credentials are encrypted with AES-256-GCM (${key.length}-byte key)`,
    );
  }
}
