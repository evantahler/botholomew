import { describe, expect, test } from "bun:test";
import {
  type ContextFileMeta,
  PromptValidationError,
  parseContextFile,
  parsePromptFile,
  serializeContextFile,
  serializePromptFile,
} from "../../src/utils/frontmatter.ts";

describe("parseContextFile", () => {
  test("parses valid frontmatter with all fields", () => {
    const raw = `---
loading: always
agent-modification: true
---

Hello world`;

    const { meta, content } = parseContextFile(raw);
    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(true);
    expect(content).toBe("Hello world");
  });

  test("parses contextual loading mode", () => {
    const raw = `---
loading: contextual
agent-modification: false
---

Some contextual content`;

    const { meta, content } = parseContextFile(raw);
    expect(meta.loading).toBe("contextual");
    expect(meta["agent-modification"]).toBe(false);
    expect(content).toBe("Some contextual content");
  });

  test("parses content with no frontmatter (loose context-file parser)", () => {
    const raw = "Just plain markdown content\nWith multiple lines";
    const { meta, content } = parseContextFile(raw);
    expect(Object.keys(meta)).toHaveLength(0);
    expect(content).toBe("Just plain markdown content\nWith multiple lines");
  });

  test("trims whitespace from content", () => {
    const raw = `---
loading: always
agent-modification: false
---

  Content with surrounding whitespace

`;

    const { content } = parseContextFile(raw);
    expect(content).toBe("Content with surrounding whitespace");
  });

  test("handles empty content section", () => {
    const raw = `---
loading: always
agent-modification: false
---
`;

    const { meta, content } = parseContextFile(raw);
    expect(meta.loading).toBe("always");
    expect(content).toBe("");
  });

  test("handles frontmatter with extra fields", () => {
    const raw = `---
loading: always
agent-modification: true
custom_field: hello
---

Content`;

    const { meta } = parseContextFile(raw);
    expect(meta.loading).toBe("always");
    expect((meta as unknown as Record<string, unknown>).custom_field).toBe(
      "hello",
    );
  });

  test("handles multiline content", () => {
    const raw = `---
loading: always
agent-modification: false
---

# Title

Paragraph one.

Paragraph two.

- Item 1
- Item 2`;

    const { content } = parseContextFile(raw);
    expect(content).toContain("# Title");
    expect(content).toContain("Paragraph one.");
    expect(content).toContain("- Item 2");
  });
});

describe("serializeContextFile", () => {
  test("serializes meta and content", () => {
    const meta: ContextFileMeta = {
      loading: "always",
      "agent-modification": true,
    };
    const result = serializeContextFile(meta, "Hello world");
    expect(result).toContain("loading: always");
    expect(result).toContain("agent-modification: true");
    expect(result).toContain("Hello world");
  });

  test("roundtrip: serialize then parse preserves data", () => {
    const meta: ContextFileMeta = {
      loading: "contextual",
      "agent-modification": false,
    };
    const content = "This is my content.\nWith multiple lines.";

    const serialized = serializeContextFile(meta, content);
    const parsed = parseContextFile(serialized);

    expect(parsed.meta.loading).toBe("contextual");
    expect(parsed.meta["agent-modification"]).toBe(false);
    expect(parsed.content).toBe(content);
  });

  test("roundtrip: parse then serialize then parse preserves data", () => {
    const raw = `---
loading: always
agent-modification: true
---

Original content here`;

    const first = parseContextFile(raw);
    const serialized = serializeContextFile(first.meta, first.content);
    const second = parseContextFile(serialized);

    expect(second.meta).toEqual(first.meta);
    expect(second.content).toBe(first.content);
  });

  test("serializes content with special characters", () => {
    const meta: ContextFileMeta = {
      loading: "always",
      "agent-modification": false,
    };
    const content = "Code: `const x = 1;`\nSymbols: <>&\"'";

    const serialized = serializeContextFile(meta, content);
    const parsed = parseContextFile(serialized);
    expect(parsed.content).toBe(content);
  });
});

describe("parsePromptFile", () => {
  test("parses a complete, valid prompt", () => {
    const raw = `---
title: Goals
loading: always
agent-modification: true
---

# Goals
- be helpful
`;
    const { meta, content } = parsePromptFile("prompts/goals.md", raw);
    expect(meta.title).toBe("Goals");
    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(true);
    expect(content).toContain("# Goals");
  });

  test("throws PromptValidationError when frontmatter is absent", () => {
    expect(() =>
      parsePromptFile("prompts/raw.md", "Just a body, no frontmatter"),
    ).toThrow(PromptValidationError);
  });

  test("error names the path so the user can find the bad file", () => {
    try {
      parsePromptFile("prompts/raw.md", "Just a body");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptValidationError);
      expect((err as Error).message).toContain("prompts/raw.md");
    }
  });

  test("throws when title is missing", () => {
    const raw = `---
loading: always
agent-modification: true
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(/title/);
  });

  test("throws when loading is missing", () => {
    const raw = `---
title: X
agent-modification: true
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(/loading/);
  });

  test("throws when agent-modification is missing", () => {
    const raw = `---
title: X
loading: always
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(
      /agent-modification/,
    );
  });

  test("throws when loading has an invalid value", () => {
    const raw = `---
title: X
loading: sometimes
agent-modification: true
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(
      PromptValidationError,
    );
  });

  test("throws when agent-modification is not a boolean", () => {
    const raw = `---
title: X
loading: always
agent-modification: yes
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(
      PromptValidationError,
    );
  });

  test("rejects unknown frontmatter keys (strict)", () => {
    const raw = `---
title: X
loading: always
agent-modification: true
extra: nope
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(/unrecognized/i);
  });

  test("throws when title is an empty string", () => {
    const raw = `---
title: ""
loading: always
agent-modification: true
---
body`;
    expect(() => parsePromptFile("prompts/x.md", raw)).toThrow(
      PromptValidationError,
    );
  });
});

describe("serializePromptFile", () => {
  test("roundtrip with parsePromptFile", () => {
    const meta = {
      title: "Beliefs",
      loading: "always" as const,
      "agent-modification": true,
    };
    const body = "- I should be concise.";
    const serialized = serializePromptFile(meta, body);
    const parsed = parsePromptFile("prompts/beliefs.md", serialized);
    expect(parsed.meta).toEqual(meta);
    expect(parsed.content).toBe(body);
  });
});
