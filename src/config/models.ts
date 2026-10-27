import type { BotholomewConfig, LlmBlock } from "./schemas.ts";

/**
 * A model entry resolved out of `config.models`, carrying its registry name so
 * error messages, logs, and the TUI can say *which* named model is in play —
 * `describeModel(llm)` only yields `provider:model`.
 */
export interface ResolvedModel {
  name: string;
  llm: LlmBlock;
}

/** Every configured model name, sorted for stable error text and listings. */
export function listModelNames(config: BotholomewConfig): string[] {
  return Object.keys(config.models).sort();
}

function unknownModelError(
  config: BotholomewConfig,
  name: string,
  source: string,
): Error {
  const available = listModelNames(config);
  const list = available.length > 0 ? available.join(", ") : "(none)";
  return new Error(
    `No model named "${name}". Configured models: ${list}. ` +
      `Add it under "models" in config/config.json, or ${source}.`,
  );
}

/**
 * Resolve a named model. `name` omitted/empty falls back to
 * `config.default_model`. Throws with the available names on a miss — callers
 * surface that message verbatim, so keep it actionable.
 */
export function resolveModel(
  config: BotholomewConfig,
  name?: string | null,
): ResolvedModel {
  const requested = name?.trim();
  if (requested) {
    const llm = config.models[requested];
    if (!llm) {
      throw unknownModelError(config, requested, "pass a name that exists");
    }
    return { name: requested, llm };
  }
  const fallback = config.default_model;
  const llm = config.models[fallback];
  if (!llm) {
    throw unknownModelError(
      config,
      fallback,
      'point "default_model" at one of them',
    );
  }
  return { name: fallback, llm };
}

/**
 * Resolve the model for one unit of work, applying the precedence chain:
 *
 *   `override` (a `--model` flag) > `pinned` (task/schedule frontmatter) > `default_model`
 *
 * The flag wins because that's the universal CLI convention, and because the
 * inverse has a real cost footgun: an operator debugging offline with
 * `--model local` would otherwise watch tasks escape to a paid frontier model.
 * When the flag displaces a pinned name, it comes back as `shadowed` so the
 * caller can log the override instead of applying it silently.
 */
export function resolveModelFor(
  config: BotholomewConfig,
  opts: { override?: string | null; pinned?: string | null },
): ResolvedModel & { shadowed?: string } {
  const override = opts.override?.trim();
  const pinned = opts.pinned?.trim();
  if (override) {
    const resolved = resolveModel(config, override);
    return pinned && pinned !== override
      ? { ...resolved, shadowed: pinned }
      : resolved;
  }
  return resolveModel(config, pinned);
}

/**
 * Resolve the auxiliary model used for cheap calls (thread titles, capability
 * summaries, schedule evaluation). Not per-run selectable — those calls are
 * bookkeeping, not the work the user asked for.
 */
export function resolveFastModel(config: BotholomewConfig): ResolvedModel {
  const name = config.fast_model;
  const llm = config.models[name];
  if (!llm) {
    throw unknownModelError(config, name, 'point "fast_model" at one of them');
  }
  return { name, llm };
}
