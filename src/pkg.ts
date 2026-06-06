// Single source of truth for our own package.json metadata.
//
// Imported statically (not read at runtime via `Bun.file(new URL(...))`) so the
// values are inlined at `bun build --compile` time. A compiled standalone
// binary has no package.json on disk beside it, so a runtime read would throw
// at startup — even for `--version` / `--help`. The static import works in both
// `bun run` (read from disk) and the compiled binary (inlined).
import pkg from "../package.json" with { type: "json" };

export { pkg };
