import { describe, expect, test } from "bun:test";
import {
  parseSkillFile,
  renderSkill,
  tokenize,
  validateSkillArgs,
} from "../../src/skills/parser.ts";

describe("parseSkillFile", () => {
  test("parses valid skill with all frontmatter fields", () => {
    const raw = `---
name: review
description: "Review a file for quality"
arguments:
  - name: file
    description: "Path to the file"
    required: true
  - name: focus
    description: "What to focus on"
    required: false
    default: "general quality"
---

Please review \`$1\` with focus on $2.`;

    const skill = parseSkillFile(raw, "/skills/review.md");
    expect(skill.name).toBe("review");
    expect(skill.description).toBe("Review a file for quality");
    expect(skill.arguments).toHaveLength(2);
    expect(skill.arguments[0]?.name).toBe("file");
    expect(skill.arguments[0]?.required).toBe(true);
    expect(skill.arguments[0]?.default).toBeUndefined();
    expect(skill.arguments[1]?.name).toBe("focus");
    expect(skill.arguments[1]?.required).toBe(false);
    expect(skill.arguments[1]?.default).toBe("general quality");
    expect(skill.body).toBe("Please review `$1` with focus on $2.");
    expect(skill.filePath).toBe("/skills/review.md");
  });

  test("derives name from filename when frontmatter omits it", () => {
    const raw = `---
description: "A simple skill"
---

Do something.`;

    const skill = parseSkillFile(raw, "/path/to/My-Skill.md");
    expect(skill.name).toBe("my-skill");
  });

  test("defaults description to empty string when missing", () => {
    const raw = `---
name: test
---

Body.`;

    const skill = parseSkillFile(raw, "/skills/test.md");
    expect(skill.description).toBe("");
  });

  test("defaults arguments to empty array when missing", () => {
    const raw = `---
name: simple
description: "No args"
---

Just do it.`;

    const skill = parseSkillFile(raw, "/skills/simple.md");
    expect(skill.arguments).toEqual([]);
  });

  test("defaults required to false when not specified", () => {
    const raw = `---
name: test
arguments:
  - name: optional-arg
    description: "An arg"
---

Body.`;

    const skill = parseSkillFile(raw, "/skills/test.md");
    expect(skill.arguments[0]?.required).toBe(false);
  });

  test("handles file with no frontmatter", () => {
    const raw = "Just a plain markdown file with no frontmatter.";
    const skill = parseSkillFile(raw, "/skills/plain.md");
    expect(skill.name).toBe("plain");
    expect(skill.description).toBe("");
    expect(skill.arguments).toEqual([]);
    expect(skill.body).toBe("Just a plain markdown file with no frontmatter.");
  });

  test("preserves multiline body content", () => {
    const raw = `---
name: multi
---

Line one.

Line two.

Line three.`;

    const skill = parseSkillFile(raw, "/skills/multi.md");
    expect(skill.body).toBe("Line one.\n\nLine two.\n\nLine three.");
  });

  test("skips malformed argument entries", () => {
    const raw = `---
name: test
arguments:
  - "just a string"
  - name: valid
    description: "ok"
---

Body.`;

    const skill = parseSkillFile(raw, "/skills/test.md");
    expect(skill.arguments).toHaveLength(1);
    expect(skill.arguments[0]?.name).toBe("valid");
  });
});

describe("renderSkill", () => {
  function makeSkill(
    body: string,
    args: {
      name: string;
      description: string;
      required: boolean;
      default?: string;
    }[] = [],
  ) {
    return {
      name: "test",
      description: "",
      arguments: args,
      body,
      filePath: "/test.md",
    };
  }

  test("replaces $ARGUMENTS with full arg string", () => {
    const skill = makeSkill("Run: $ARGUMENTS");
    expect(renderSkill(skill, "foo bar baz")).toBe("Run: foo bar baz");
  });

  test("replaces $1 and $2 with positional args", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [],
      body: "Review $1 focusing on $2.",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "src/main.ts security")).toBe(
      "Review src/main.ts focusing on security.",
    );
  });

  test("handles quoted strings as single positional arg", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [],
      body: "File: $1, Focus: $2",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, '"src/my file.ts" performance')).toBe(
      "File: src/my file.ts, Focus: performance",
    );
  });

  test("applies default values for missing optional args", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "file", description: "", required: true },
        { name: "focus", description: "", required: false, default: "general" },
      ],
      body: "Review $1, focus: $2",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "src/main.ts")).toBe(
      "Review src/main.ts, focus: general",
    );
  });

  test("replaces missing args with no default as empty string", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [],
      body: "A: $1, B: $2",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "only-one")).toBe("A: only-one, B: ");
  });

  test("returns body unchanged when no variables present", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [],
      body: "Just summarize everything.",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "")).toBe("Just summarize everything.");
  });

  test("handles empty args string", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "thing", description: "", required: false, default: "all" },
      ],
      body: "Summarize $1.",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "")).toBe("Summarize all.");
  });

  test("treats $10 as $1 followed by literal 0", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [],
      body: "Value: $10",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "hello")).toBe("Value: hello0");
  });

  test("substitutes named arg placeholders from positional tokens", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "start_date", description: "", required: false },
        { name: "end_date", description: "", required: false },
      ],
      body: "From $start_date to $end_date.",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "2026-01-01 2026-01-15")).toBe(
      "From 2026-01-01 to 2026-01-15.",
    );
  });

  test("named args fall back to declared defaults", () => {
    const skill = {
      name: "test",
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
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "")).toBe("From yesterday to today.");
  });

  test("named placeholders are word-boundary safe", () => {
    // $start should NOT clip $start_date when $start is also declared.
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "start", description: "", required: false, default: "S" },
        {
          name: "start_date",
          description: "",
          required: false,
          default: "SD",
        },
      ],
      body: "$start | $start_date",
      filePath: "/test.md",
    };
    // Positional: $1 = "a" → start, $2 = "b" → start_date
    expect(renderSkill(skill, "a b")).toBe("a | b");
  });

  test("mixes $1 and named placeholders in same body", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "file", description: "", required: true },
        { name: "focus", description: "", required: false, default: "all" },
      ],
      body: "Review $1 ($file) focusing on $focus.",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "src/main.ts perf")).toBe(
      "Review src/main.ts (src/main.ts) focusing on perf.",
    );
  });

  test("$ARGUMENTS still works alongside named placeholders", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [{ name: "topic", description: "", required: false }],
      body: "Topic: $topic | Raw: $ARGUMENTS",
      filePath: "/test.md",
    };
    expect(renderSkill(skill, "auth")).toBe("Topic: auth | Raw: auth");
  });

  test("ignores named args with non-identifier names", () => {
    // Defensive: an arg with a weird name shouldn't blow up the regex.
    const skill = {
      name: "test",
      description: "",
      arguments: [{ name: "1bad", description: "", required: false }],
      body: "literal $1bad",
      filePath: "/test.md",
    };
    // No named substitution; $1 still expands so "$1bad" becomes "valuebad"
    expect(renderSkill(skill, "value")).toBe("literal valuebad");
  });
});

describe("tokenize", () => {
  test("splits on whitespace", () => {
    expect(tokenize("a b c")).toEqual(["a", "b", "c"]);
  });

  test("respects double-quoted strings", () => {
    expect(tokenize('"a b" c')).toEqual(["a b", "c"]);
  });

  test("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("validateSkillArgs", () => {
  test("returns no missing when no required args", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [{ name: "topic", description: "", required: false }],
      body: "",
      filePath: "/test.md",
    };
    expect(validateSkillArgs(skill, "")).toEqual({ missing: [] });
  });

  test("flags required args without token or default", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "file", description: "", required: true },
        { name: "focus", description: "", required: true },
      ],
      body: "",
      filePath: "/test.md",
    };
    expect(validateSkillArgs(skill, "a")).toEqual({ missing: ["focus"] });
  });

  test("required arg with default is satisfied", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        {
          name: "file",
          description: "",
          required: true,
          default: "src/index.ts",
        },
      ],
      body: "",
      filePath: "/test.md",
    };
    expect(validateSkillArgs(skill, "")).toEqual({ missing: [] });
  });

  test("returns no missing when all required args provided", () => {
    const skill = {
      name: "test",
      description: "",
      arguments: [
        { name: "file", description: "", required: true },
        { name: "focus", description: "", required: false, default: "all" },
      ],
      body: "",
      filePath: "/test.md",
    };
    expect(validateSkillArgs(skill, "src/main.ts")).toEqual({ missing: [] });
  });
});
