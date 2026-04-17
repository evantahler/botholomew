# Doc captures (screenshots & GIFs)

Screenshots and GIFs of the chat TUI are **generated**, not hand-taken, so they
stay current as the TUI evolves. One command regenerates every asset; the diff
of `docs/assets/` tells reviewers what changed.

## How it works

Two pieces:

1. **[VHS](https://github.com/charmbracelet/vhs)** drives a real PTY and
   renders a declarative `.tape` script (typed keystrokes + sleeps) into a
   GIF, MP4, or PNG.
2. **Fake LLM mode** — when `BOTHOLOMEW_FAKE_LLM=1` is set, every Anthropic
   client in the codebase is swapped for a scripted stub that streams
   fixture-defined replies (see `src/daemon/fake-llm.ts`). This makes
   captures hermetic: no API key required, no network, and every run produces
   the same output.

## Install once

```bash
brew install vhs ttyd ffmpeg
```

(Linux: `apt install ttyd ffmpeg` plus VHS from its
[releases page](https://github.com/charmbracelet/vhs/releases).)

## Regenerate all assets

```bash
bun run capture
```

The script creates an ephemeral project directory under `$TMPDIR`, runs
`botholomew init` in it, then runs VHS once per tape in `docs/tapes/` — serially,
since VHS contends for the tty. Output GIFs land in `docs/assets/`. Commit
those changes alongside the TUI change that prompted them.

Run a single tape:

```bash
bun run capture chat-happy-path
```

## Adding a new capture

1. **Write a fixture** under `docs/tapes/fixtures/<name>.json`:

   ```json
   {
     "turns": [
       {
         "match": "optional regex against the user's message",
         "text": "The reply to stream back.",
         "chunkSize": 5,
         "delayMs": 30
       }
     ]
   }
   ```

   Turns without a `match` are consumed in order. Add `toolCalls` if the
   capture needs to show tool use.

2. **Write a tape** at `docs/tapes/<name>.tape`:

   ```tape
   Source docs/tapes/_common.tape
   Output docs/assets/<name>.gif

   Sleep 1s
   Type "botholomew chat --no-daemon"
   Sleep 600ms
   Enter
   Sleep 4s

   Type `whats on my schedule today`
   Sleep 600ms
   Enter
   Sleep 10s
   ```

   Note: `Type "..."` (double-quoted) for the shell command, `` Type `...` ``
   (backticked) for anything typed into the TUI — see the limitations
   section above.

   The fixture file must share the tape's base name. `_common.tape` pins
   terminal dimensions, theme, font, and typing speed — source it from every
   tape for a consistent look.

3. **Run** `bun run capture <name>` and review the output in `docs/assets/`.

4. **Embed** the GIF from the relevant doc with `![alt](./assets/<name>.gif)`.

## Why this approach

- **Deterministic.** Fake replies + pinned VHS settings mean byte-stable GIFs
  (modulo VHS upgrades). `git diff docs/assets/` is meaningful.
- **Hermetic.** No API key needed, so CI can regenerate captures on merge.
- **Decoupled.** The TUI itself is unchanged — the fake swap lives at the
  daemon LLM boundary (`src/daemon/llm-client.ts`), so the same stub can be
  reused for deterministic agent-loop tests.

## Known VHS/ttyd limitations

A few real sharp edges surfaced while building this; they're all worth
knowing before you write a new tape.

- **Always use backticks for `Type` content, not double-quotes.** VHS's tape
  parser drops characters from double-quoted strings when they're piped
  through ttyd into an Ink raw-mode TUI — you'll see only some of what you
  typed, or nothing at all. The correct form is:

  ```tape
  Type `whats on my schedule today`
  ```

  Double-quoted `Type "..."` is fine at the shell level (before the TUI
  launches), but use backticks for anything typed into the TUI input bar.

- **`Sleep N` is seconds.** `Sleep 500` is 8 minutes and 20 seconds. Always
  suffix: `Sleep 500ms`, `Sleep 2s`.

- **Non-text keystrokes (`Tab`, `Escape`) don't reliably reach Ink.** VHS's
  `Tab` / `Escape` commands send escape sequences that Ink's legacy parser
  under ttyd doesn't recognize. `Enter` works (it's just `\r`). If you need
  to drive tab navigation in a capture, use `-p "<prompt>"` to auto-submit an
  initial message, or add a CLI flag that lets the capture land on a
  specific tab.

- **Under `BOTHOLOMEW_FAKE_LLM=1` the chat command forces Ink's
  kitty-keyboard mode to `"disabled"`** (see `src/commands/chat.ts`), because
  ttyd can't negotiate the Kitty Keyboard protocol. Without that, even
  plain-text typing is dropped. Don't remove that guard without
  re-running `bun run capture`.

- **`Hide` … `Show` hides keystrokes from the recording.** If you want
  viewers to see the command being typed out, just don't use `Hide` — start
  the tape with the shell prompt visible and let the typing animation play.

## Keybinding reference (for the real TUI — not for tapes)

- `Tab` cycles tabs; `Shift+Tab` is not wired up.
- `1`–`7` jump to a tab **only when not on the Chat tab** (on Chat those keys
  are input).
- `Escape` returns to Chat from any other tab.
- `/` opens the slash-command popup; type to filter; `Escape` dismisses.
- `Ctrl+C` exits the TUI.
