import { describe, expect, test } from "bun:test";
import {
  handleSlashCommand,
  type SlashCommandContext,
} from "../../src/skills/commands.ts";
import type { SkillDefinition } from "../../src/skills/parser.ts";

function makeCtx(
  skills: Map<string, SkillDefinition> = new Map(),
  opts: { withClearChat?: boolean } = {},
): SlashCommandContext & {
  systemMessages: string[];
  queuedMessages: string[];
  exited: boolean;
  clearCalls: number;
} {
  const ctx = {
    skills,
    systemMessages: [] as string[],
    queuedMessages: [] as string[],
    exited: false,
    clearCalls: 0,
    addSystemMessage: (content: string) => {
      ctx.systemMessages.push(content);
    },
    queueUserMessage: (content: string) => {
      ctx.queuedMessages.push(content);
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

  test("dispatches skill and renders template", () => {
    const skills = makeSkillMap(reviewSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/review src/main.ts", ctx);
    expect(result).toBe(true);
    expect(ctx.systemMessages).toHaveLength(1);
    expect(ctx.systemMessages[0]).toContain("Running skill: review");
    expect(ctx.queuedMessages).toHaveLength(1);
    expect(ctx.queuedMessages[0]).toBe("Please review `src/main.ts`.");
  });

  test("dispatches skill with no arguments", () => {
    const skills = makeSkillMap(summarizeSkill);
    const ctx = makeCtx(skills);
    const result = handleSlashCommand("/summarize", ctx);
    expect(result).toBe(true);
    expect(ctx.queuedMessages[0]).toBe("Summarize this conversation.");
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
});
