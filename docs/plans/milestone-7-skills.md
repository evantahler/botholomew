# Milestone 7: Skills (Slash-Commands)

## Goal

Add user-defined slash-commands ("skills") loaded from markdown files in `.botholomew/skills/`. When a user types `/skill-name` in the chat TUI, the skill's markdown body is interpolated with any arguments and injected into the conversation as a user message, giving the agent structured instructions for common workflows.

## What Gets Unblocked

- Users can create reusable prompt templates for recurring workflows (standup updates, code review, summarization)
- The chat TUI becomes extensible without modifying source code
- Built-in default skills ship with `botholomew init`, providing immediate value
- A CLI surface (`botholomew skill list`) lets users discover and manage skills outside the TUI
- Tab-completion in the input bar makes skills discoverable

---

## Implementation

### 1. Skill File Format and Parsing (`src/skills/parser.ts`)

Skill files live at `.botholomew/skills/<name>.md`. They use the same `gray-matter` YAML frontmatter convention as the existing context files.

**Frontmatter schema:**

```yaml
---
name: review
description: "Ask the agent to review a file"
arguments:
  - name: file
    description: "Path to the file to review"
    required: true
  - name: focus
    description: "What to focus on (security, performance, etc.)"
    required: false
    default: "general quality"
---
```

**Body:** Markdown content serving as the prompt template. Variable substitution uses `$ARGUMENTS` (the full argument string) and `$1`, `$2`, etc. (positional arguments).

**Types and functions:**

```typescript
interface SkillArgDef {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

interface SkillDefinition {
  name: string;           // derived from filename if not in frontmatter
  description: string;
  arguments: SkillArgDef[];
  body: string;           // raw markdown template
  filePath: string;       // absolute path to the .md file
}

function parseSkillFile(raw: string, filePath: string): SkillDefinition;
function renderSkill(skill: SkillDefinition, args: string): string;
```

`parseSkillFile` reuses `gray-matter` (same dependency as `src/utils/frontmatter.ts`). `renderSkill` substitutes `$ARGUMENTS` with the raw argument string, `$1`/`$2`/etc. with positional args (split on whitespace, respecting quoted strings), and applies defaults for missing optional arguments. Returns the final prompt string.

### 2. Skill Discovery and Loading (`src/skills/loader.ts`)

```typescript
function getSkillsDir(projectDir: string): string;

async function loadSkills(projectDir: string): Promise<Map<string, SkillDefinition>>;
async function getSkill(projectDir: string, name: string): Promise<SkillDefinition | null>;
```

`loadSkills` reads all `.md` files from `.botholomew/skills/`, parses each with `parseSkillFile`, and returns a `Map` keyed by skill name (filename without `.md`, or the `name` frontmatter field). It should be called once at chat session start and cached on the `ChatSession` object. The skill name is normalized to lowercase with hyphens (matching the filename convention).

A new constant `SKILLS_DIR = "skills"` is added to `src/constants.ts` alongside the existing `MCPX_DIR`.

### 3. Integration with Chat TUI Input Handling (`src/tui/App.tsx`)

The `handleSubmit` function in `App.tsx` currently has hardcoded if-statements for `/help`, `/quit`, and `/exit`. Refactor into a dispatch pattern:

```typescript
if (trimmed.startsWith("/")) {
  const handled = await handleSlashCommand(trimmed, skills, {
    setMessages, exit, sessionRef, queueRef, processQueue, setInputHistory,
  });
  if (handled) return;
  // Not recognized — fall through to send as regular message
}
```

A new function `handleSlashCommand` in `src/skills/commands.ts` centralizes all slash-command dispatch:

```typescript
async function handleSlashCommand(
  input: string,
  skills: Map<string, SkillDefinition>,
  handlers: SlashCommandHandlers,
): Promise<boolean>;
```

This function:
1. Parses the input into command name and arguments (e.g., `/review src/main.ts` → name=`review`, args=`src/main.ts`)
2. Checks built-in commands first (`/help`, `/quit`, `/exit`, `/skills`)
3. Looks up the skill by name in the loaded skills map
4. If found, calls `renderSkill` to produce the final prompt, then queues it as a user message
5. Returns `true` if handled, `false` if the command was not recognized

A system message is shown in the TUI indicating which skill was invoked (e.g., "Running skill: review").

A new built-in command `/skills` lists all available skills with their descriptions.

### 4. Skill Listing in Help (`src/tui/App.tsx`)

The `/help` command output is extended to include a "Skills:" section listing all loaded skills. If no skills are loaded, it shows "No skills found. Add .md files to .botholomew/skills/".

### 5. Tab-Completion for Skill Names (`src/tui/components/InputBar.tsx`)

The `InputBar` component currently ignores Tab key presses. Modify to support basic slash-command completion:

- When the input starts with `/` and the user presses Tab, cycle through matching skill names
- A new prop `completions: string[]` is passed to `InputBar`, containing all available slash-command names (built-in + loaded skills)
- Prefix-matching: if input is `/rev` and Tab is pressed, complete to `/review`. If multiple matches, cycle on subsequent Tab presses
- InputBar calls a new `onTabComplete` callback prop; App checks whether InputBar consumed the tab event before switching panels

### 6. Built-in Default Skills (`src/init/templates.ts`)

Three default skills ship with `botholomew init`:

**`summarize.md`:**
```yaml
---
name: summarize
description: "Summarize the current conversation"
arguments: []
---
Summarize this conversation so far. Provide a concise bullet-point summary
of what we discussed, any decisions made, and any open action items.
```

**`standup.md`:**
```yaml
---
name: standup
description: "Generate a standup update from recent tasks"
arguments: []
---
Generate a standup update. Look at recent tasks (completed in the last 24 hours
and currently in progress) and format a brief standup-style update with:
- What was done (completed tasks)
- What's in progress
- Any blockers or waiting items
```

**`review.md`:**
```yaml
---
name: review
description: "Review a file for quality and issues"
arguments:
  - name: file
    description: "Path to the file to review"
    required: true
---
Please review the file at `$1`. Read it using the available tools, then provide:
1. A brief summary of what the file does
2. Any issues or concerns (bugs, security, performance)
3. Suggestions for improvement
4. An overall assessment
```

In `src/init/index.ts`, `initProject` is extended to create `.botholomew/skills/` and write these default skill files. Template strings are added to `src/init/templates.ts`.

### 7. CLI Command (`src/commands/skill.ts`)

A new CLI command registered in `src/cli.ts`:

```typescript
registerSkillCommand(program);
```

Subcommands:
- `botholomew skill list` — lists all skills with name, description, argument count
- `botholomew skill show <name>` — prints the full skill file content
- `botholomew skill create <name>` — creates a new skill file from a minimal template

### 8. Caching Skills on ChatSession (`src/chat/session.ts`)

The `ChatSession` interface gets a new field:

```typescript
interface ChatSession {
  // ...existing fields...
  skills: Map<string, SkillDefinition>;
}
```

In `startChatSession`, skills are loaded once via `loadSkills(projectDir)` and stored on the session.

---

## Files Modified

| File | Change |
|------|--------|
| `src/skills/parser.ts` | **New** — skill file parsing, argument substitution, `SkillDefinition` type |
| `src/skills/loader.ts` | **New** — discover and load skill files from `.botholomew/skills/` |
| `src/skills/commands.ts` | **New** — slash-command dispatch logic, built-in commands |
| `src/constants.ts` | Add `SKILLS_DIR` constant and `getSkillsDir()` helper |
| `src/tui/App.tsx` | Refactor `handleSubmit` to use `handleSlashCommand`, pass skills + completions |
| `src/tui/components/InputBar.tsx` | Add tab-completion for `/` prefixed input |
| `src/chat/session.ts` | Add `skills` field to `ChatSession`, load skills at session start |
| `src/init/index.ts` | Create `skills/` directory, write default skill files |
| `src/init/templates.ts` | Add `SUMMARIZE_SKILL`, `STANDUP_SKILL`, `REVIEW_SKILL` template constants |
| `src/commands/skill.ts` | **New** — CLI command for `skill list`, `skill show`, `skill create` |
| `src/cli.ts` | Register `registerSkillCommand` |

## Tests

- `test/skills/parser.test.ts` — parse valid skill files, handle missing frontmatter fields, argument substitution with positional args, defaults, quoted strings
- `test/skills/loader.test.ts` — load from directory, handle empty directory, handle malformed files gracefully, name deduplication
- `test/skills/commands.test.ts` — slash-command dispatch: built-in commands, skill invocation, unknown command handling, argument passing
- `test/init/init.test.ts` — verify `initProject` creates `skills/` directory with default skill files (extend existing test)

## Verification

1. `botholomew init --force` in a test directory — `.botholomew/skills/` exists with `summarize.md`, `standup.md`, `review.md`
2. `botholomew skill list` — prints table of 3 default skills with names and descriptions
3. `botholomew skill show review` — prints full content of `review.md`
4. `botholomew skill create daily-log` — creates `.botholomew/skills/daily-log.md` with template frontmatter
5. `botholomew chat` then type `/skills` — shows list of available skills in chat
6. Type `/summarize` — system message "Running skill: summarize" appears, agent responds with conversation summary
7. Type `/review src/cli.ts` — skill renders with `$1` replaced by `src/cli.ts`, agent reads and reviews the file
8. Type `/rev` then press Tab — input completes to `/review`
9. Type `/nonexistent` — message "Unknown command: /nonexistent. Type /skills to see available commands."
10. `/help` output includes a "Skills:" section listing all loaded skills
