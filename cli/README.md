# botholomew

The Botholomew command line: an HTTP client for the same session surface as the website. It does not boot the
API. The command is `botholomew`, with `bothy` as an alias.

```bash
bun run --cwd cli botholomew login --url http://localhost:8080 --email you@example.com --password '$BOTHOLOMEW_PASSWORD'
bun run --cwd cli botholomew project list
bun run --cwd cli botholomew --project 1 member list --json
bun run --cwd cli botholomew --project 1 invite create --email mario@example.com --tag operators
```

The default API origin is `https://api.botholomew.com`; `--url` or `BOTHOLOMEW_URL` points it elsewhere, and
`--project` or `BOTHOLOMEW_PROJECT` (or `botholomew project use`) selects a project by id or slug. The session is
stored in `~/.config/botholomew/config.json` (or under `$XDG_CONFIG_HOME`) with mode `0600`.

The package is private: Botholomew 2.0 is in development, and v1 owns the `botholomew` name on npm. The user
documentation is at `/docs/cli` on the website.
