# Milestone 5: Chat TUI

## Goal

Build the interactive terminal UI. The user chats with Botholomew in real-time — the agent can answer questions, enqueue tasks for the daemon, and show results from past daemon work. Styled after Claude Code.

## What Gets Unblocked

- Users can interact with Botholomew conversationally
- Tasks can be created through natural language instead of CLI flags
- Full visibility into daemon activity from the TUI

---

## Implementation

### 1. TUI Architecture (`src/tui/`)

Built with Ink 6 + React 19. Key components:

**`src/tui/App.tsx`** — top-level layout:
- Header bar: project name, daemon status (running/stopped), task queue count
- Message list: scrollable conversation history
- Input area: text input at the bottom

**`src/tui/components/MessageList.tsx`**
- Renders conversation messages with role-based styling:
  - User messages: plain text
  - Assistant messages: markdown rendering (bold, lists, code blocks)
  - Tool use: collapsed by default, expandable
  - System messages: dim/italic
- Auto-scrolls to bottom on new messages

**`src/tui/components/InputBar.tsx`**
- Multi-line text input using `ink-text-input`
- Enter to send, Shift+Enter for newline
- Typing indicator while agent is responding

**`src/tui/components/StatusBar.tsx`**
- Daemon status: running (green) / stopped (red)
- Active task count, pending task count
- Last tick time

**`src/tui/components/ToolCall.tsx`**
- Renders a tool use + result pair
- Collapsed summary by default, expand with tab/click
- Shows tool name, input, output, duration

### 2. Chat Agent (`src/chat/agent.ts`)

The chat agent is separate from the daemon agent — it has its own system prompt and tool set.

**System prompt:**
- Same persistent context (always-loaded files)
- Role: "You are Botholomew's chat interface. Help the user manage tasks, review results, and answer questions. You do NOT execute long-running work — enqueue tasks for the daemon instead."

**Chat tools:**
- `create_task` — enqueue a task for the daemon
- `list_tasks` — show current tasks and their status
- `view_task` — get task details and linked thread/interactions
- `search_context` — search the context database
- `list_threads` — browse recent daemon activity
- `view_thread` — see full interaction log for a thread
- `create_schedule` — set up recurring work
- `list_schedules` — view schedules
- `update_beliefs` — modify beliefs.md (agent-editable)
- `update_goals` — modify goals.md (agent-editable)

### 3. Chat Session Lifecycle (`src/chat/session.ts`)

- `startChatSession(projectDir)` — open DB, create a `chat_session` thread, return session handle
- `sendMessage(session, userMessage)` — send user message, get streaming response, log all interactions
- `endChatSession(session)` — close thread, close DB

Streaming: Use the Anthropic SDK's streaming API (`client.messages.stream()`) to show tokens as they arrive in the TUI.

### 4. Wire Chat Command (`src/commands/chat.ts`)

Replace stub:
- Load config, open DB
- Start chat session
- Render `<App />` via Ink, passing the session
- On exit (Ctrl+C / `/quit`), end session and exit

### 5. Persistent Context Editing

When the chat agent calls `update_beliefs` or `update_goals`:
- Read the current file
- Apply the modification (LLM provides the new content)
- Write back with frontmatter preserved
- Log a `context_update` interaction

---

## Files Modified

| File | Change |
|------|--------|
| `src/tui/App.tsx` | Full implementation |
| `src/tui/components/MessageList.tsx` | **New** |
| `src/tui/components/InputBar.tsx` | **New** |
| `src/tui/components/StatusBar.tsx` | **New** |
| `src/tui/components/ToolCall.tsx` | **New** |
| `src/chat/agent.ts` | **New** — chat agent with tools |
| `src/chat/session.ts` | **New** — session lifecycle |
| `src/commands/chat.ts` | Full implementation |

## New Dependencies

- `ink-text-input` — text input for Ink
- `ink-spinner` — loading indicator
- `ink-markdown` or custom — markdown rendering in terminal (evaluate options)

## Tests

- `test/chat/agent.test.ts` — chat agent tools dispatch correctly (mock LLM)
- `test/chat/session.test.ts` — session creates/ends threads, logs interactions
- `test/tui/` — component rendering tests with ink-testing-library

## Verification

1. `botholomew chat` — opens TUI with header, empty message area, input bar
2. Type "create a task to read my email" — agent creates task, confirms in chat
3. Type "what tasks are pending?" — agent lists tasks
4. Type "show me what the daemon did last" — agent fetches recent thread, shows interactions
5. Ctrl+C exits cleanly, thread is ended in DB
6. Re-open chat — previous conversations are logged in threads table
