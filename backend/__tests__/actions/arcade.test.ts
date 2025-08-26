import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { api } from "../../api";
import { config } from "../../config";
import {
  createTestUser,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";

// Mock the Arcade client
const mockArcadeClient = {
  tools: {
    list: mock(() =>
      Promise.resolve({
        items: [
          {
            name: "web_search_tool",
            description: "Search the web for information",
            toolkit: { name: "web_search", description: "Web search toolkit" },
          },
          {
            name: "file_read",
            description: "Read files",
            toolkit: {
              name: "file_operations",
              description: "File operations toolkit",
            },
          },
          {
            name: "file_write",
            description: "Write files",
            toolkit: {
              name: "file_operations",
              description: "File operations toolkit",
            },
          },
          {
            name: "data_analyze",
            description: "Analyze data",
            toolkit: {
              name: "data_analysis",
              description: "Data analysis toolkit",
            },
          },
          {
            name: "generate_image",
            description: "Generate images",
            toolkit: {
              name: "image_generation",
              description: "Image generation toolkit",
            },
          },
        ],
      }),
    ),
  },
};

const mockToZod = mock(() => [
  { name: "web_search", description: "Search the web for information" },
  { name: "file_operations", description: "Perform file operations" },
  { name: "data_analysis", description: "Analyze data" },
  { name: "image_generation", description: "Generate images" },
]);

const mockExecuteOrAuthorizeZodTool = mock(() => ({}));

mock.module("@arcadeai/arcadejs", () => ({
  Arcade: mock().mockImplementation(() => mockArcadeClient),
  toZod: mockToZod,
  executeOrAuthorizeZodTool: mockExecuteOrAuthorizeZodTool,
}));

mock.module("@arcadeai/arcadejs/lib", () => ({
  toZod: mockToZod,
  executeOrAuthorizeZodTool: mockExecuteOrAuthorizeZodTool,
}));

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();

  // Mock the arcade client after API initialization
  api.arcade = {
    client: mockArcadeClient as any,
    loadArcadeToolsForAgent: mock(() => Promise.resolve([])),
    getAvailableToolkits: mock(() =>
      Promise.resolve([
        {
          name: "web_search",
          description: "Web search toolkit",
          tools: ["web_search_tool"],
        },
        {
          name: "file_operations",
          description: "File operations toolkit",
          tools: ["file_read", "file_write"],
        },
        {
          name: "data_analysis",
          description: "Data analysis toolkit",
          tools: ["data_analyze"],
        },
        {
          name: "image_generation",
          description: "Image generation toolkit",
          tools: ["generate_image"],
        },
      ]),
    ),
  };

  await api.db.clearDatabase();
  await createTestUser(USERS.LUIGI);
});

afterAll(async () => {
  await api.stop();
});

describe("arcade:list-toolkits", () => {
  let user: any;
  let session: any;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
  });

  test("should list available toolkits", async () => {
    const toolkitsResponse = await fetch(`${url}/api/arcade/toolkits`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    const toolkitsData = await toolkitsResponse.json();
    expect(toolkitsResponse.status).toBe(200);
    expect(toolkitsData.toolkits).toBeDefined();
    expect(Array.isArray(toolkitsData.toolkits)).toBe(true);

    // Verify the toolkits are returned correctly
    expect(toolkitsData.toolkits.length).toBeGreaterThan(0);

    // Verify toolkit structure
    const firstToolkit = toolkitsData.toolkits[0];
    expect(firstToolkit).toBeDefined();
    expect(firstToolkit.name).toBeDefined();
    expect(firstToolkit.description).toBeDefined();
    expect(Array.isArray(firstToolkit.tools)).toBe(true);
  });

  test("should require authentication for listing toolkits", async () => {
    const response = await fetch(`${url}/api/arcade/toolkits`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(401);
  });
});
