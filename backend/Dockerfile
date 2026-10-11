# Build from the REPO ROOT, not from backend/:
#   docker build -f backend/Dockerfile .
# The root lockfile governs the whole Bun workspace, so the build context has to
# include it.

# ---- Build stage ----
FROM oven/bun:1 AS build
WORKDIR /app

# Root lockfile + every workspace manifest, copied before the sources so this
# layer caches across source-only changes.
COPY bun.lock package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY cli/package.json cli/package.json

RUN bun install --frozen-lockfile

COPY backend/ backend/

# Pre-generate the OpenAPI response schemas into backend/.cache/, which the
# runtime stage inherits with the rest of backend/.
#
# Not an optimization. Without this file the server generates the schemas on
# first boot, and that path runs ts-morph over every action: it peaks at
# **~1.4 GB RSS** against a settled footprint of ~80 MB, so any container under
# about 1.5 GB is killed before it finishes starting — with no traffic, no
# request, and nothing in the log to say why. On Render's 512 MB starter that is
# a crash loop. Here the same work happens once, on a builder with room for it.
#
# It needs no Postgres and no Redis, which is what makes it safe in a build.
RUN cd backend && bun keryx.ts build

# ---- Runtime stage ----
FROM oven/bun:1-slim
WORKDIR /app/backend

COPY --from=build /app/backend /app/backend
COPY --from=build /app/node_modules /app/node_modules

EXPOSE 10000

CMD ["bun", "keryx.ts", "start"]
