import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import { resolveModel } from "../config/models.ts";
import { describeModel } from "../llm/index.ts";
import { assertModelFlag } from "./model-flag.ts";

export function registerChatCommand(program: Command) {
  program
    .command("chat")
    .description(
      "Open the interactive chat TUI\n\n" +
        "  Tab navigation (Ctrl+<letter> from any tab):\n" +
        "    Ctrl+a  Chat        Ctrl+t  Tasks       Ctrl+w  Workers\n" +
        "    Ctrl+o  Tools       Ctrl+e  Threads     Ctrl+p  Approvals\n" +
        "    Ctrl+n  Context     Ctrl+s  Schedules   Ctrl+g  Help\n" +
        "                                            Esc     Return to Chat\n\n" +
        "  Refresh: Ctrl+R refreshes Context · Tasks · Threads · Schedules · Workers\n\n" +
        "  Chat input:\n" +
        "    Enter          Send message\n" +
        "    ⌥+Enter        Insert newline\n" +
        "    ↑/↓            Browse input history\n" +
        "    Esc            Steer / abort an in-flight turn\n" +
        "    Ctrl+J/K       Navigate queued messages\n" +
        "    Ctrl+E/X       Edit / remove the selected queued message\n\n" +
        "  Slash commands:\n" +
        "    /help           Show chat-command reference (Help tab has the full keymap)\n" +
        "    /skills         List available skills\n" +
        "    /dream          Reflect on recent threads — consolidate learnings, update beliefs/goals\n" +
        "    /clear          End current thread and start a new one\n" +
        "    /exit           End the chat session",
    )
    .option("--thread-id <id>", "Resume an existing chat thread")
    .option("-p, --prompt <text>", "Start chat with an initial prompt")
    .option(
      "--unsafe",
      "bypass the mcpx approval gate (allow every tool without approval)",
      false,
    )
    .option(
      "--model <name>",
      "named model from the `models` block in config (default: `default_model`)",
    )
    .action(
      async (opts: {
        threadId?: string;
        prompt?: string;
        unsafe?: boolean;
        model?: string;
      }) => {
        const { render } = await import("ink");
        const React = await import("react");
        const { App } = await import("../tui/App.tsx");
        const dir = program.opts().dir;
        const config = await loadConfig(dir);
        const idleTimeoutMs = config.tui_idle_timeout_seconds * 1000;

        // Validate + resolve here as well as in `startChatSession`, so an
        // unknown --model prints a one-line error instead of a stack trace
        // buried under a torn-down Ink render, and so the status bar has a
        // label before the session opens.
        await assertModelFlag(dir, opts.model);
        const { name: modelName, llm } = resolveModel(config, opts.model);
        const modelLabel = `${modelName} · ${describeModel(llm)}`;

        // VHS/ttyd doesn't fully negotiate the Kitty Keyboard protocol, so
        // Ink's "enabled" mode drops non-text keystrokes (Tab, Escape) under
        // capture. Use "disabled" mode in capture to keep text input working;
        // captures that need Tab/Escape should use the `-p` prompt flag or
        // a /slash command typed as text instead.
        const isCapture = process.env.BOTHOLOMEW_FAKE_LLM === "1";
        const instance = render(
          React.createElement(App, {
            projectDir: dir,
            threadId: opts.threadId,
            initialPrompt: opts.prompt,
            idleTimeoutMs,
            unsafe: opts.unsafe,
            modelName,
            modelLabel,
          }),
          {
            exitOnCtrlC: false,
            kittyKeyboard: isCapture
              ? { mode: "disabled" }
              : {
                  mode: "enabled",
                  flags: ["disambiguateEscapeCodes"],
                },
          },
        );
        await instance.waitUntilExit();
      },
    );
}
