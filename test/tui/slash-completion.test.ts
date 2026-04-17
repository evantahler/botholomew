import { describe, expect, test } from "bun:test";
import type { SlashCommand } from "../../src/skills/commands.ts";
import {
  buildSlashCommands,
  getSlashMatches,
  MAX_VISIBLE_COMPLETIONS,
} from "../../src/tui/slashCompletion.ts";

const commands: SlashCommand[] = [
  { name: "help", description: "Show help" },
  { name: "skills", description: "List skills" },
  { name: "quit", description: "Exit" },
  { name: "exit", description: "Exit" },
  { name: "review", description: "Review a file" },
  { name: "summarize", description: "Summarize the chat" },
];

describe("getSlashMatches", () => {
  test("returns null when value doesn't start with /", () => {
    expect(getSlashMatches("hello", commands)).toBeNull();
    expect(getSlashMatches("", commands)).toBeNull();
  });

  test("returns all commands for a bare slash", () => {
    const result = getSlashMatches("/", commands);
    expect(result).not.toBeNull();
    expect(result?.map((c) => c.name)).toEqual([
      "help",
      "skills",
      "quit",
      "exit",
      "review",
      "summarize",
    ]);
  });

  test("filters by prefix", () => {
    const result = getSlashMatches("/s", commands);
    expect(result?.map((c) => c.name)).toEqual(["skills", "summarize"]);
  });

  test("is case-insensitive", () => {
    const result = getSlashMatches("/SK", commands);
    expect(result?.map((c) => c.name)).toEqual(["skills"]);
  });

  test("returns null on no matches", () => {
    expect(getSlashMatches("/zzzz", commands)).toBeNull();
  });

  test("returns null once a space is typed", () => {
    expect(getSlashMatches("/review ", commands)).toBeNull();
    expect(getSlashMatches("/review foo.ts", commands)).toBeNull();
  });

  test("returns null for multi-word values starting with /", () => {
    expect(getSlashMatches("/help me", commands)).toBeNull();
  });

  test("caps results at MAX_VISIBLE_COMPLETIONS", () => {
    const many: SlashCommand[] = Array.from(
      { length: MAX_VISIBLE_COMPLETIONS + 5 },
      (_, i) => ({ name: `cmd${i}`, description: "" }),
    );
    const result = getSlashMatches("/cmd", many);
    expect(result).toHaveLength(MAX_VISIBLE_COMPLETIONS);
  });

  test("accepts hyphens in command names", () => {
    const withHyphen: SlashCommand[] = [
      { name: "daily-log", description: "" },
      { name: "daily-standup", description: "" },
    ];
    const result = getSlashMatches("/daily-s", withHyphen);
    expect(result?.map((c) => c.name)).toEqual(["daily-standup"]);
  });
});

describe("buildSlashCommands", () => {
  test("concatenates builtins then skills", () => {
    const builtins: SlashCommand[] = [{ name: "help", description: "Help" }];
    const skills = [
      { name: "review", description: "Review a file" },
      { name: "summarize", description: "Summarize" },
    ];
    const result = buildSlashCommands(builtins, skills);
    expect(result.map((c) => c.name)).toEqual(["help", "review", "summarize"]);
    expect(result[1]?.description).toBe("Review a file");
  });

  test("preserves builtin order and does not dedupe", () => {
    const builtins: SlashCommand[] = [
      { name: "quit", description: "Exit" },
      { name: "exit", description: "Exit" },
    ];
    const result = buildSlashCommands(builtins, []);
    expect(result.map((c) => c.name)).toEqual(["quit", "exit"]);
  });
});
