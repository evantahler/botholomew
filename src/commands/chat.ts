import type { Command } from "commander";

export function registerChatCommand(program: Command) {
  program
    .command("chat")
    .description("Open the interactive chat TUI")
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
      );
      await instance.waitUntilExit();
    });
}
