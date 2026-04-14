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
        "    /quit, /exit    End the chat session",
    )
    .option("--thread-id <id>", "Resume an existing chat thread")
    .action(async (opts: { threadId?: string }) => {
      const { render } = await import("ink");
      const React = await import("react");
      const { App } = await import("../tui/App.tsx");
      const dir = program.opts().dir;
      const instance = render(
        React.createElement(App, {
          projectDir: dir,
          threadId: opts.threadId,
        }),
        {
          kittyKeyboard: {
            mode: "enabled",
            flags: ["disambiguateEscapeCodes", "reportEventTypes"],
          },
        },
      );
      await instance.waitUntilExit();
    });
}
