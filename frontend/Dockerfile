# Build from the REPO ROOT, not from frontend/:
#   docker build -f frontend/Dockerfile --build-arg VITE_API_URL=... .

# ---- Build stage ----
FROM oven/bun:1 AS build
WORKDIR /app

# Vite inlines VITE_API_URL at BUILD time, so it is a build arg rather than a
# runtime env var: changing it requires a rebuild, not a restart.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Root lockfile + every workspace manifest (mirrors backend/Dockerfile).
COPY bun.lock package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY cli/package.json cli/package.json

RUN bun install --frozen-lockfile

# The Vite build needs backend SOURCES, not just its manifest — `tsc -b`
# resolves action response types through the `@backend/*` path alias.
COPY backend/ backend/
COPY frontend/ frontend/

RUN bun run --cwd frontend build

# ---- Runtime stage ----
FROM nginx:1.27-alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 10000
