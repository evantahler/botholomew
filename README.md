# Botholomew

Botholomew is an Agent Framework for general purpose agents. It is based on [Actionhero](https://github.com/actionhero/actionhero) and [bun-actionhero](https://github.com/evantahler/bun-actionhero) and is built with [Bun](https://bun.sh).

## Getting Started

Ensure you have [Bun](https://bun.sh), [Redis](https://redis.io/), and [Postgres](https://www.postgresql.org/) installed.

Create Databases

```bash
createdb botholomew
createdb botholomew_test
```

Setup Env

```bash
cp .env.example .env
# And update the values, especially the database connection strings
```

```bash
bun install
bun start
```
