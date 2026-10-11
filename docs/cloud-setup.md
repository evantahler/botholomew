# Cloud setup

For architecture, conventions, and the full command list, read [`AGENTS.md`](../AGENTS.md) and
[`README.md`](../README.md). This file records only the non-obvious things a cloud agent VM needs to run the app.

## Services

Postgres and Redis are **system services installed with apt**, not Docker and not systemd units — systemd is not
init on these VMs, so `systemctl` and `brew services` do nothing. Disk state survives a snapshot; the daemons do
not, so start them at the beginning of every session:

```bash
sudo pg_ctlcluster <major> main start               # Postgres (pg_lsclusters names the major)
sudo redis-server --daemonize yes                   # Redis
pg_lsclusters && redis-cli ping                     # "online" and "PONG"
```

The app needs the **pgvector** extension available to that cluster: `sudo apt-get install postgresql-<major>-pgvector`,
where `<major>` matches the running cluster. When the package is not in the VM's apt sources, it is installable from
the PostgreSQL apt repository (`apt.postgresql.org`). Nothing in the baseline migration creates the extension, so
the suites run without it; anything that does needs it installed first.

## Databases and roles

```bash
sudo -u postgres createuser -s "$(whoami)"          # a superuser matching the shell user
createdb botholomew && createdb botholomew_test
```

`.env.example` ships `postgres://localhost:5432/...` URLs with no user and no password. Two things make that work:

- **Loopback TCP must be `trust`.** A fresh cluster's `pg_hba.conf` usually says `scram-sha-256` for
  `127.0.0.1/32` and `::1/128`; change both `host` lines to `trust`, then
  `sudo pg_ctlcluster <major> main reload`. A cluster that was not changed answers
  `fe_sendauth: no password supplied`.
- **`$USER` must be set.** With no user in the URL, the Postgres client connects as `$USER`, and some VM shells
  leave it unset. The symptom is every suite failing at boot with
  `Cannot connect to database (postgres://localhost:5432/botholomew_test): Error: Failed query: SELECT NOW()`,
  which looks like a broken branch and is not. `export USER=$(whoami)` before running anything.

## `.env` files

Both are gitignored, and their absence is disguised:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Without `backend/.env`, `MCP_SERVER_ENABLED` is `false` (the framework default), so `/mcp` is never registered and
every MCP test fails as `Action not found`. The web server also binds `localhost` instead of `0.0.0.0`, which fails
`status.test.ts`'s loopback assertion. Treat a missing `.env` as the first thing to rule out when a suite fails in a
way the diff cannot explain.

## Running the app and the suites

`bun dev` from the root runs the backend on `:8080` and the Vite frontend on `:3000`; run it as a long-lived
process. The backend is also the task worker in development (`TASKS_ENABLED=true`).

- Run tests with `bun run test`, or per workspace (`cd backend && bun test`). Bare `bun test` at the root shadows
  the script with Bun's own runner and misses `backend/bunfig.toml`.
- **Never run two backend suites at once against the same test database.** Every suite that boots a server opens
  with `clearDatabase()`, so a second concurrent run truncates the first one's rows mid-assertion. The Playwright
  suite's backend reads the same `_TEST` values, so it collides too. To run both, give one of them its own
  database and Redis index with real environment variables, which win over `.env`:

  ```bash
  createdb botholomew_e2e
  DATABASE_URL_TEST=postgres://localhost:5432/botholomew_e2e REDIS_URL_TEST=redis://localhost:6379/5 \
    bun run test:e2e
  ```

- A Chromium for Playwright is not part of `bun install`. When the VM provides one (`PLAYWRIGHT_BROWSERS_PATH`),
  use it; otherwise `cd frontend && bunx playwright install chromium`.
