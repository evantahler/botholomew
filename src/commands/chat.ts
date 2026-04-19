import type { Command } from "commander";

export function registerChatCommand(program: Command) {
  program
    .command("chat")
    .description(
      "Open the interactive chat TUI\n\n" +
        "  Keyboard shortcuts:\n" +
        "    Enter          Send message\n" +
        "    ⌥+Enter        Insert newline (multiline input)\n" +
        "    ↑/↓            Browse input history\n\n" +
        "  Commands:\n" +
        "    /help           Show keyboard shortcuts\n" +
        "    /tools          Open tool call inspector\n" +
        "    /exit           End the chat session",
    )
    .option("--thread-id <id>", "Resume an existing chat thread")
    .option("-p, --prompt <text>", "Start chat with an initial prompt")
    .action(async (opts: { threadId?: string; prompt?: string }) => {
      const { render } = await import("ink");
      const React = await import("react");
      const { App } = await import("../tui/App.tsx");
      const dir = program.opts().dir;

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
    });
}
