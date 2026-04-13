import { describe, expect, test } from "bun:test";
import {
  type ContextFileMeta,
  parseContextFile,
  serializeContextFile,
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

  test("parses content with no frontmatter", () => {
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
