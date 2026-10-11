/**
 * Resolve a `$VAR` / `${VAR}` reference in a secret-taking flag from the
 * operator's environment, so the secret itself never has to be typed into a
 * command line and its shell history.
 *
 * Only a value that is entirely one reference is resolved: `$HOME/x` and
 * `pa$$word` are literals. `$$` at the start of a value escapes it, so a secret
 * that really begins with `$` is passed as `$$…`.
 */

/** A referenced environment variable that is not set. */
export class UnresolvedSecretError extends Error {
  /**
   * @param label - What the value was for, e.g. `--password`.
   * @param envName - The env var that was missing.
   */
  constructor(
    readonly label: string,
    readonly envName: string,
  ) {
    super(
      `${label} references $${envName}, which is not set in the environment`,
    );
    this.name = "UnresolvedSecretError";
  }
}

/**
 * Resolve one secret-bearing value.
 * @param value - The flag's value as typed.
 * @param label - What the value was for, named in the error.
 * @param env - Environment map (usually `process.env`).
 * @returns The resolved value, or `value` unchanged when it is not a reference.
 * @throws {UnresolvedSecretError} When the referenced variable is missing or empty.
 */
export function resolveSecretValue(
  value: string,
  label: string,
  env: NodeJS.Dict<string>,
): string {
  if (value.startsWith("$$")) return value.slice(1);

  const braced = value.match(/^\$\{([A-Z][A-Z0-9_]*)\}$/);
  const simple = value.match(/^\$([A-Z][A-Z0-9_]*)$/);
  const name = braced?.[1] ?? simple?.[1];
  if (!name) return value;

  const resolved = env[name];
  if (resolved === undefined || resolved === "") {
    throw new UnresolvedSecretError(label, name);
  }
  return resolved;
}
