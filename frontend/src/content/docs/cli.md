# CLI

The `botholomew` CLI (alias `bothy`) is an HTTP client for the same session as the website. Everything it does, a signed-in member could do by clicking — and the API enforces the same rules either way. It does **not** boot the API.

## Run it

The CLI runs from a checkout of the Botholomew repository with [Bun](https://bun.sh):

```bash
bun install
bun run --cwd cli botholomew --help
```

The examples below write `botholomew` for `bun run --cwd cli botholomew`.

## Sign in

```bash
botholomew login --email you@example.com --password '$BOTHOLOMEW_PASSWORD'
botholomew whoami
botholomew logout
```

`--password` takes the password itself or a `$VAR` / `${VAR}` reference the CLI reads from your environment, which keeps the password out of your shell history. Login stores the session cookie in `$XDG_CONFIG_HOME/botholomew/config.json` (or `~/.config/botholomew/config.json`), readable only by you. `whoami` shows the signed-in user. `logout` ends the session and forgets the cookie.

## Global options

| Option | Environment | Meaning |
| --- | --- | --- |
| `--url <origin>` | `BOTHOLOMEW_URL` | The API origin, without `/api`. Defaults to the origin saved at login, then `https://api.botholomew.com` |
| `--project <id-or-slug>` | `BOTHOLOMEW_PROJECT` | Which project a command acts on. Defaults to the one saved with `project use` |
| `--json` | | Print JSON, with no color and no banner |
| `--no-color` | `NO_COLOR` | Strip color from the output |

Against a local API:

```bash
botholomew login --url http://localhost:8080 --email you@example.com --password '$BOTHOLOMEW_PASSWORD'
```

List commands take `--page` and `--limit` (25 by default).

## Commands

### Projects

| Command | Does |
| --- | --- |
| `project list` | List the projects you belong to |
| `project create --name <name>` | Create a project; you become its admin |
| `project use <id-or-slug>` | Save a project as the default for later commands |
| `project view` | Show the selected project, your tags in it, and its MCP address |
| `project edit --name <name>` | Rename the selected project (admin) |
| `project delete` | Delete the selected project and its tags, memberships, and invites (admin). It does not ask twice |

### Tags

| Command | Does |
| --- | --- |
| `tag list` | List the project's tags |
| `tag create --name <name>` | Create a tag (admin) |
| `tag edit <id> --name <name>` | Rename a tag (admin) |
| `tag delete <id>` | Delete a tag, revoking it from everyone (admin) |
| `tag assign --user <id> --tag <id>` | Grant a tag to a member (admin) |
| `tag unassign --user <id> --tag <id>` | Revoke a tag from a member (admin) |

The reserved `admin` tag cannot be created, renamed, or deleted, and cannot be revoked from the project's last admin.

### Members

| Command | Does |
| --- | --- |
| `member list` | List members and the tags each holds |
| `member add --email <email>` | Add an existing user to the project (admin) |
| `member remove <userId>` | Remove a member (admin). The last admin cannot be removed |

### Invites

| Command | Does |
| --- | --- |
| `invite list` | List every invite this project has sent, in any status (admin) |
| `invite pending` | List the invites addressed to you |
| `invite create --email <email> [--tag <name-or-id> …]` | Invite somebody, granting tags when they accept (admin). Repeat `--tag` for more than one |
| `invite accept <id>` | Accept an invite addressed to you |
| `invite reject <id>` | Decline an invite addressed to you |

### Audit

| Command | Does |
| --- | --- |
| `audit list [--since <ts>] [--until <ts>] [--action <name>]` | List the project's audit log, newest first (admin). Times are ISO dates or epoch milliseconds; `--action` is an exact action name such as `tag:edit` |

## A session

```bash
botholomew login --email peach@example.com --password '$BOTHOLOMEW_PASSWORD'
botholomew project list
botholomew project use peach-s-project
botholomew tag create --name operators
botholomew invite create --email mario@example.com --tag operators
botholomew member list --json
botholomew audit list --action invite:create
```
