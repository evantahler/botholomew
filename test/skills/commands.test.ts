import { describe, expect, test } from "bun:test";
import {
  handleSlashCommand,
  type SlashCommandContext,
} from "../../src/skills/commands.ts";
import type { SkillDefinition } from "../../src/skills/parser.ts";

interface QueuedEntry {
  content: string;
  display: string;
}

function makeCtx(
  skills: Map<string, SkillDefinition> = new Map(),
  opts: { withClearChat?: boolean } = {},
): SlashCommandContext & {
  systemMessages: string[];
  queuedMessages: QueuedEntry[];
  exited: boolean;
  clearCalls: number;
} {
  const ctx = {
    skills,
    systemMessages: [] as string[],
    queuedMessages: [] as QueuedEntry[],
    exited: false,
    clearCalls: 0,
    addSystemMessage: (content: string) => {
      ctx.systemMessages.push(content);
    },
    queueUserMessage: (content: string, opts?: { display?: string }) => {
      ctx.queuedMessages.push({
        content,
        display: opts?.display ?? content,
      });
    },
    exit: () => {
      ctx.exited = true;
    },
    clearChat: opts.withClearChat
      ? () => {
          ctx.clearCalls++;
        }
      : undefined,
  };
  return ctx;
}

function makeSkillMap(
  ...skills: SkillDefinition[]
): Map<string, SkillDefinition> {
  const map = new Map<string, SkillDefinition>();
  for (const s of skills) {
    map.set(s.name, s);
  }
  return map;
}

const reviewSkill: SkillDefinition = {
  name: "review",
  description: "Review a file",
  arguments: [{ name: "file", description: "Path", required: true }],
  body: "Please review `$1`.",
  filePath: "/skills/review.md",
};

const summarizeSkill: SkillDefinition = {
  name: "summarize",
  description: "Summarize conversation",
  arguments: [],
  body: "Summarize this conversation.",
  filePath: "/skills/summarize.md",
};

describe("handleSlashCommand", () => {
  test("/exit calls exit", () => {
    const ctx = makeCtx();
    const result = handleSlashCommand("/exit", ctx);
    expect(result).toBe(true);
    expect(ctx.exited).toBe(true);
  });

  test("/skills lists available skills", () => {
    const skills = makeSkillMap(reviewSkill, summarizeSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/skills", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(1);
    expect(ctx.systemMessages[0]).toContain("review");
    expect(ctx.systemMessages[0]).toContain("summarize");
  });

  test("/skills shows message when no skills loaded", () => {
    const ctx = makeCtx();
    const result = handleSlashCommand("/skills", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages[0]).toContain("No skills loaded");
  });

  test("dispatches skill, renders content, displays slash command", () => {
    const skills = makeSkillMap(reviewSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/review src/main.ts", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(0);
    expect(ctx.queuedMessages).toHaveLength(1);
    expect(ctx.queuedMessages[0]?.content).toBe("Please review `src/main.ts`.");
    expect(ctx.queuedMessages[0]?.display).toBe("/review src/main.ts");
  });

  test("dispatches skill with no arguments", () => {
    const skills = makeSkillMap(summarizeSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/summarize", ctx);
    expect(result).toBe(true);
    expect(ctx.queuedMessages[0]?.content).toBe("Summarize this conversation.");
    expect(ctx.queuedMessages[0]?.display).toBe("/summarize");
  });

  test("rejects skill invocation missing required args", () => {
    const skills = makeSkillMap(reviewSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/review", ctx);
    expect(result).toBe(true);
    expect(ctx.queuedMessages).toHaveLength(0);
    expect(ctx.systemMessages).toHaveLength(1);
    expect(ctx.systemMessages[0]).toContain("missing required argument(s)");
    expect(ctx.systemMessages[0]).toContain("file");
    expect(ctx.systemMessages[0]).toContain("Usage: /review <file>");
  });

  test("optional arg with default is rendered when omitted", () => {
    const bizSkill: SkillDefinition = {
      name: "biz-update",
      description: "",
      arguments: [
        {
          name: "start_date",
          description: "",
          required: false,
          default: "yesterday",
        },
        {
          name: "end_date",
          description: "",
          required: false,
          default: "today",
        },
      ],
      body: "From $start_date to $end_date.",
      filePath: "/skills/biz-update.md",
    };
    const skills = makeSkillMap(bizSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/biz-update", ctx);
    expect(result).toBe(true);
    expect(ctx.queuedMessages).toHaveLength(1);
    expect(ctx.queuedMessages[0]?.content).toBe("From yesterday to today.");
    expect(ctx.queuedMessages[0]?.display).toBe("/biz-update");
  });

  test("required arg with default counts as satisfied", () => {
    const skill: SkillDefinition = {
      name: "thing",
      description: "",
      arguments: [
        {
          name: "name",
          description: "",
          required: true,
          default: "world",
        },
      ],
      body: "Hello $name",
      filePath: "/skills/thing.md",
    };
    const ctx = makeCtx(makeSkillMap(skill));
    const result = handleSlashCommand("/thing", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(0);
    expect(ctx.queuedMessages[0]?.content).toBe("Hello world");
  });

  test("unknown command shows error", () => {
    const ctx = makeCtx();
    const result = handleSlashCommand("/nonexistent", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages[0]).toContain("Unknown command: /nonexistent");
    expect(ctx.systemMessages[0]).toContain("/skills");
  });

  test("command name is case-insensitive", () => {
    const skills = makeSkillMap(reviewSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/REVIEW src/main.ts", ctx);
    expect(result).toBe(true);
    expect(ctx.queuedMessages).toHaveLength(1);
  });

  test("/clear invokes clearChat when provided", () => {
    const ctx = makeCtx(new Map(), { withClearChat: true });
    const result = handleSlashCommand("/clear", ctx);
    expect(result).toBe(true);
    expect(ctx.clearCalls).toBe(1);
    expect(ctx.systemMessages).toHaveLength(0);
  });

  test("/clear warns when clearChat is not provided", () => {
    const ctx = makeCtx();
    const result = handleSlashCommand("/clear", ctx);
    expect(result).toBe(true);
    expect(ctx.clearCalls).toBe(0);
    expect(ctx.systemMessages[0]).toContain("only available in the chat TUI");
  });

  test("1-arg skill: unquoted multi-word input is rendered into $1", () => {
    const writeSkill: SkillDefinition = {
      name: "write",
      description: "",
      arguments: [{ name: "topic", description: "", required: true }],
      body: "Topic: $1",
      filePath: "/skills/write.md",
    };
    const ctx = makeCtx(makeSkillMap(writeSkill));
    const result = handleSlashCommand("/write why are avocados good?", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(0);
    expect(ctx.queuedMessages).toHaveLength(1);
    expect(ctx.queuedMessages[0]?.content).toBe(
      "Topic: why are avocados good?",
    );
  });

  test("2-arg skill: unquoted multi-word input is blocked with hint", () => {
    const writeAsEvan: SkillDefinition = {
      name: "write-as-evan",
      description: "",
      arguments: [
        { name: "topic", description: "", required: true },
        {
          name: "format",
          description: "",
          required: false,
          default: "blog-post",
        },
      ],
      body: "About `$1` (**$2**)",
      filePath: "/skills/write-as-evan.md",
    };
    const ctx = makeCtx(makeSkillMap(writeAsEvan));
    const result = handleSlashCommand(
      "/write-as-evan why are avocados good?",
      ctx,
    );
    expect(result).toBe(true);
    expect(ctx.queuedMessages).toHaveLength(0);
    expect(ctx.systemMessages).toHaveLength(1);
    const hint = ctx.systemMessages[0] ?? "";
    expect(hint).toContain("ambiguous input");
    expect(hint).toContain("topic");
    expect(hint).toContain("format");
    expect(hint).toContain("why");
    expect(hint).toContain("are avocados good?");
    expect(hint).toContain('"why are avocados good?"');
  });

  test("2-arg skill: quoted multi-word input proceeds normally", () => {
    const writeAsEvan: SkillDefinition = {
      name: "write-as-evan",
      description: "",
      arguments: [
        { name: "topic", description: "", required: true },
        {
          name: "format",
          description: "",
          required: false,
          default: "blog-post",
        },
      ],
      body: "About `$1` (**$2**)",
      filePath: "/skills/write-as-evan.md",
    };
    const ctx = makeCtx(makeSkillMap(writeAsEvan));
    const result = handleSlashCommand(
      "/write-as-evan 'why are avocados good?'",
      ctx,
    );
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(0);
    expect(ctx.queuedMessages).toHaveLength(1);
    expect(ctx.queuedMessages[0]?.content).toBe(
      "About `why are avocados good?` (**blog-post**)",
    );
  });

  test("2-arg skill: clean two-word input proceeds normally", () => {
    const skill: SkillDefinition = {
      name: "review",
      description: "",
      arguments: [
        { name: "file", description: "", required: true },
        { name: "focus", description: "", required: false, default: "all" },
      ],
      body: "Review $1 focusing on $2.",
      filePath: "/skills/review.md",
    };
    const ctx = makeCtx(makeSkillMap(skill));
    const result = handleSlashCommand("/review src/cli.ts security", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(0);
    expect(ctx.queuedMessages).toHaveLength(1);
    expect(ctx.queuedMessages[0]?.content).toBe(
      "Review src/cli.ts focusing on security.",
    );
  });
});
