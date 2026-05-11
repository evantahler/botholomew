#!/usr/bin/env bash
# Lint runner: tsc --noEmit + biome check, with a narrow filter for one
# specific upstream type error.
#
# Membot v0.12.4 ships its TS source as `main`/`types`, and one cast in
# `node_modules/membot/src/mount/mcp.ts:25` doesn't satisfy the MCP SDK's
# `AnySchema | ZodRawShapeCompat` union type. The mismatch is harmless at
# runtime (we don't even reach the MCP-mount code path from Botholomew)
# but `tsc` walks the transitive import graph from `membot/src/sdk.ts`,
# so it blocks CI on every consumer of membot.
#
# Tracked upstream at:
#   https://github.com/evantahler/membot/issues/57
#   https://github.com/evantahler/membot/issues/59
#
# Once membot publishes a release that satisfies the SDK's type, drop
# this filter and revert package.json's `lint` script back to a plain
# `tsc --noEmit && biome check .`.

set -uo pipefail

UPSTREAM_BUG_PATH="node_modules/membot/src/mount/mcp.ts"

tsc_output=$(bun x tsc --noEmit 2>&1)
tsc_status=$?

if [ "$tsc_status" -ne 0 ]; then
  # Drop the upstream error line AND its indented continuation lines (tsc
  # prints multi-line errors as `path(L,C): error TSxxxx: ...\n  More\n  More`).
  # Everything else passes through and still fails the build below.
  filtered=$(
    printf '%s\n' "$tsc_output" \
      | awk -v path="$UPSTREAM_BUG_PATH" '
          index($0, path)        { skip=1; next }
          skip && /^[[:space:]]/ { next }
                                 { skip=0; print }
        '
  )

  if printf '%s\n' "$filtered" | grep -q 'error TS'; then
    printf '%s\n' "$filtered"
    exit 1
  fi

  # Only the upstream error remained — warn about it on stderr so it
  # stays visible, but don't fail the lint job.
  printf 'lint: ignoring one known upstream tsc error in %s (see issues #57/#59)\n' \
    "$UPSTREAM_BUG_PATH" >&2
fi

exec bun x biome check .
