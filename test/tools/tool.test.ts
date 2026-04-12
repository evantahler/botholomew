import { describe, test, expect, beforeEach } from "bun:test";
import { z } from "zod";

// Fresh-import the module each test to reset the registry
let registerTool: typeof import("../../src/tools/tool.ts").registerTool;
let getTool: typeof import("../../src/tools/tool.ts").getTool;
let getAllTools: typeof import("../../src/tools/tool.ts").getAllTools;
let getToolsByGroup: typeof import("../../src/tools/tool.ts").getToolsByGroup;
let toAnthropicTool: typeof import("../../src/tools/tool.ts").toAnthropicTool;
let toAnthropicTools: typeof import("../../src/tools/tool.ts").toAnthropicTools;

// Since the registry is module-level state, we import once and test with unique names
beforeEach(async () => {
  const mod = await import("../../src/tools/tool.ts");
  registerTool = mod.registerTool;
  getTool = mod.getTool;
  getAllTools = mod.getAllTools;
  getToolsByGroup = mod.getToolsByGroup;
  toAnthropicTool = mod.toAnthropicTool;
  toAnthropicTools = mod.toAnthropicTools;
});

function makeTool(overrides: Partial<Parameters<typeof registerTool>[0]> = {}) {
  return {
    name: `test_${Date.now()}_${Math.random()}`,
    description: "A test tool",
    group: "test",
    inputSchema: z.object({
      path: z.string().describe("A file path"),
    }),
    outputSchema: z.object({
      content: z.string(),
    }),
    execute: async () => ({ content: "ok" }),
    ...overrides,
  };
}

describe("Tool registry", () => {
  test("registerTool adds tool to registry", () => {
    const tool = makeTool();
    registerTool(tool);
    expect(getTool(tool.name)).toBe(tool);
  });

  test("getTool returns undefined for unknown tool", () => {
    expect(getTool("nonexistent_tool_xyz")).toBeUndefined();
  });

  test("getAllTools includes registered tools", () => {
    const tool = makeTool();
    registerTool(tool);
    const all = getAllTools();
    expect(all.some((t) => t.name === tool.name)).toBe(true);
  });

  test("getToolsByGroup filters by group", () => {
    const toolA = makeTool({ group: "alpha" });
    const toolB = makeTool({ group: "beta" });
    registerTool(toolA);
    registerTool(toolB);

    const alphaTools = getToolsByGroup("alpha");
    expect(alphaTools.some((t) => t.name === toolA.name)).toBe(true);
    expect(alphaTools.some((t) => t.name === toolB.name)).toBe(false);
  });
});

describe("Anthropic adapter", () => {
  test("toAnthropicTool produces valid tool definition", () => {
    const tool = makeTool({
      name: "anthro_test",
      description: "Test description",
      inputSchema: z.object({
        path: z.string().describe("Virtual path"),
        limit: z.number().optional().describe("Max results"),
      }),
    });

    const result = toAnthropicTool(tool);

    expect(result.name).toBe("anthro_test");
    expect(result.description).toBe("Test description");
    expect(result.input_schema.type).toBe("object");
    expect(result.input_schema.properties).toEqual({
      path: { type: "string", description: "Virtual path" },
      limit: { type: "number", description: "Max results" },
    });
    expect(result.input_schema.required).toEqual(["path"]);
  });

  test("toAnthropicTools converts all registered tools", () => {
    const tool = makeTool();
    registerTool(tool);
    const all = toAnthropicTools();
    expect(all.some((t) => t.name === tool.name)).toBe(true);
    expect(all.every((t) => t.input_schema.type === "object")).toBe(true);
  });
});

describe("Tool execution", () => {
  test("execute receives validated input and returns typed output", async () => {
    const tool = makeTool({
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().optional(),
      }),
      outputSchema: z.object({
        content: z.string(),
        lines: z.number(),
      }),
      execute: async (input) => ({
        content: `read: ${input.path}`,
        lines: input.offset ?? 0,
      }),
    });

    const result = await tool.execute(
      { path: "/test.md" },
      {} as any, // ctx not needed for this test
    );
    expect(result.content).toBe("read: /test.md");
    expect(result.lines).toBe(0);
  });

  test("inputSchema validates input", () => {
    const tool = makeTool({
      inputSchema: z.object({
        path: z.string(),
      }),
    });

    const good = tool.inputSchema.safeParse({ path: "/test" });
    expect(good.success).toBe(true);

    const bad = tool.inputSchema.safeParse({ path: 123 });
    expect(bad.success).toBe(false);

    const missing = tool.inputSchema.safeParse({});
    expect(missing.success).toBe(false);
  });
});
