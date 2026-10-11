# Botholomew

Botholomew 2.0 is a **cloud service of always-on bot swarms**. Every project has a team of bots — one leader and
any number of workers — that share the project's memory, MCP servers, and skills, and that people reach from the
website, the command line, Slack, and iMessage.

> **In development.** What runs today is the platform underneath: sign up, land in your own project, invite
> teammates, grant tags (the reserved `admin` tag administers a project), read the audit log, connect your own
> MCP client (Claude, an IDE) to manage all of it, and do the same from the `botholomew` CLI. No bot runs yet.
> The design for everything else is in [`docs/plans/`](./docs/plans/README.md).
>
> The v1 local CLI/TUI agent lives on the [`v1` branch](https://github.com/evantahler/botholomew/tree/v1), and
> v1 installs from there.

Built on [Keryx](https://www.keryxjs.com/): one action class is an HTTP endpoint, a CLI command, a background
task, and an OAuth-protected MCP tool.

## Running it locally

You need [Bun](https://bun.sh), Postgres with the [pgvector](https://github.com/pgvector/pgvector) extension, and
Redis, all as system services — never Docker or Docker Compose.

```bash
brew install postgresql@17 pgvector redis && brew services start postgresql@17 redis
createdb botholomew && createdb botholomew_test

bun install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

bun dev                  # backend on :8080, frontend on :3000
open http://localhost:3000
```

The backend migrates its database on boot. Sign up, and you land in your own project as its admin.

```bash
bun run lint             # tsc + biome, every workspace
bun run test             # backend (real server over HTTP), frontend, and CLI suites
bun run test:e2e         # Playwright against the real stack

bun run --cwd cli botholomew login --url http://localhost:8080 --email you@example.com --password '…'
bun run --cwd cli botholomew project list
```

On a cloud agent VM, read [`docs/cloud-setup.md`](./docs/cloud-setup.md) first.

## Where to read next

- [`AGENTS.md`](./AGENTS.md) — the rules and conventions for anyone (or any agent) changing this repository.
- [`docs/plans/README.md`](./docs/plans/README.md) — the roadmap, the data model, and the architecture.
- `/docs` on a running frontend — the user documentation.
