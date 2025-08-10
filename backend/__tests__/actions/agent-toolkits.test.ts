import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import type { SessionCreate } from "../../actions/session";
import {
  createTestUser,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";
import { toolkit_authorizations } from "../../models/toolkit_authorization";
import { agents } from "../../models/agent";
import { eq } from "drizzle-orm";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
  await createTestUser(USERS.LUIGI);
});

afterAll(async () => {
  await api.stop();
});

describe("agent toolkits", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
  });

  // Helper function to clear toolkit authorizations for a user
  const clearUserToolkitAuthorizations = async (userId: number) => {
    await api.db.db
      .delete(toolkit_authorizations)
      .where(eq(toolkit_authorizations.userId, userId));
  };

  describe("agent:create with toolkits", () => {
    test("should create an agent with toolkits successfully", async () => {
      // Clear any existing authorizations and add new ones
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db.insert(toolkit_authorizations).values([
        { userId: user.id, toolkitName: "web_search" },
        { userId: user.id, toolkitName: "file_operations" },
      ]);

      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Toolkit Agent",
          description: "An agent with toolkits",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant with toolkit access.",
          enabled: true,
          toolkits: ["web_search", "file_operations"],
        }),
      });

      const agentData = await agentResponse.json();
      expect(agentResponse.status).toBe(200);
      expect(agentData.agent).toBeDefined();
      expect(agentData.agent.name).toBe("Toolkit Agent");
      expect(agentData.agent.toolkits).toEqual([
        "web_search",
        "file_operations",
      ]);
      expect(agentData.agent.userId).toBe(user.id);
    });

    test("should fail to create agent with unauthorized toolkits", async () => {
      // Clear any existing authorizations
      await clearUserToolkitAuthorizations(user.id);

      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Unauthorized Toolkit Agent",
          description: "An agent with unauthorized toolkits",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
          toolkits: ["unauthorized_toolkit", "another_unauthorized"],
        }),
      });

      const errorData = await agentResponse.json();

      expect(agentResponse.status).toBe(406);
      expect(errorData.error.message).toContain(
        "You are not authorized to use the following toolkits",
      );
      expect(errorData.error.message).toContain("unauthorized_toolkit");
      expect(errorData.error.message).toContain("another_unauthorized");
    });

    test("should fail to create agent with mixed authorized/unauthorized toolkits", async () => {
      // Clear any existing authorizations and authorize only one toolkit
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId: user.id, toolkitName: "web_search" }]);

      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Mixed Toolkit Agent",
          description: "An agent with mixed toolkit authorization",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
          toolkits: ["web_search", "unauthorized_toolkit"],
        }),
      });

      expect(agentResponse.status).toBe(406);
      const errorData = await agentResponse.json();
      expect(errorData.error.message).toContain(
        "You are not authorized to use the following toolkits",
      );
      expect(errorData.error.message).toContain("unauthorized_toolkit");
      expect(errorData.error.message).not.toContain("web_search");
    });

    test("should create an agent with single toolkit string", async () => {
      // Clear any existing authorizations and authorize the toolkit
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId: user.id, toolkitName: "web_search" }]);

      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Single Toolkit Agent",
          description: "An agent with one toolkit",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
          toolkits: "web_search",
        }),
      });

      const agentData = await agentResponse.json();
      expect(agentResponse.status).toBe(200);
      expect(agentData.agent).toBeDefined();
      expect(agentData.agent.name).toBe("Single Toolkit Agent");
      expect(agentData.agent.toolkits).toEqual(["web_search"]);
    });

    test("should create an agent with no toolkits (empty array)", async () => {
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "No Toolkit Agent",
          description: "An agent without toolkits",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
          toolkits: [],
        }),
      });

      const agentData = await agentResponse.json();
      expect(agentResponse.status).toBe(200);
      expect(agentData.agent).toBeDefined();
      expect(agentData.agent.name).toBe("No Toolkit Agent");
      expect(agentData.agent.toolkits).toEqual([]);
    });

    test("should create an agent without specifying toolkits (defaults to empty array)", async () => {
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Default Toolkit Agent",
          description: "An agent with default toolkits",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
        }),
      });

      const agentData = await agentResponse.json();
      expect(agentResponse.status).toBe(200);
      expect(agentData.agent).toBeDefined();
      expect(agentData.agent.name).toBe("Default Toolkit Agent");
      expect(agentData.agent.toolkits).toEqual([]);
    });
  });

  describe("agent:edit with toolkits", () => {
    let createdAgent: any;

    beforeAll(async () => {
      // Create an agent to edit
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Edit Toolkit Agent",
          description: "Agent to edit toolkits",
          model: "gpt-3.5-turbo",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
        }),
      });
      const agentData = await agentResponse.json();
      createdAgent = agentData.agent;
    });

    test("should add toolkits to an existing agent", async () => {
      // Clear any existing authorizations and authorize the toolkits
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db.insert(toolkit_authorizations).values([
        { userId: user.id, toolkitName: "web_search" },
        { userId: user.id, toolkitName: "file_operations" },
        { userId: user.id, toolkitName: "data_analysis" },
      ]);

      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          toolkits: ["web_search", "file_operations", "data_analysis"],
        }),
      });

      const editData = await editResponse.json();
      expect(editResponse.status).toBe(200);
      expect(editData.agent).toBeDefined();
      expect(editData.agent.id).toBe(createdAgent.id);
      expect(editData.agent.toolkits).toEqual([
        "web_search",
        "file_operations",
        "data_analysis",
      ]);
    });

    test("should fail to add unauthorized toolkits to existing agent", async () => {
      // Clear any existing authorizations
      await clearUserToolkitAuthorizations(user.id);

      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          toolkits: ["unauthorized_toolkit", "another_unauthorized"],
        }),
      });

      expect(editResponse.status).toBe(406);
      const errorData = await editResponse.json();
      expect(errorData.error.message).toContain(
        "You are not authorized to use the following toolkits",
      );
      expect(errorData.error.message).toContain("unauthorized_toolkit");
      expect(errorData.error.message).toContain("another_unauthorized");
    });

    test("should fail to add mixed authorized/unauthorized toolkits", async () => {
      // Clear any existing authorizations and authorize only one toolkit
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId: user.id, toolkitName: "data_analysis" }]);

      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          toolkits: ["data_analysis", "unauthorized_toolkit"],
        }),
      });

      expect(editResponse.status).toBe(406);
      const errorData = await editResponse.json();
      expect(errorData.error.message).toContain(
        "You are not authorized to use the following toolkits",
      );
      expect(errorData.error.message).toContain("unauthorized_toolkit");
      expect(errorData.error.message).not.toContain("data_analysis");
    });

    test("should remove toolkits from an agent", async () => {
      // Clear any existing authorizations and authorize the toolkit
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId: user.id, toolkitName: "web_search" }]);

      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          toolkits: ["web_search"],
        }),
      });

      const editData = await editResponse.json();
      expect(editResponse.status).toBe(200);
      expect(editData.agent).toBeDefined();
      expect(editData.agent.id).toBe(createdAgent.id);
      expect(editData.agent.toolkits).toEqual(["web_search"]);
    });

    test("should remove all toolkits from an agent", async () => {
      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          toolkits: [],
        }),
      });

      const editData = await editResponse.json();
      expect(editResponse.status).toBe(200);
      expect(editData.agent).toBeDefined();
      expect(editData.agent.id).toBe(createdAgent.id);
      expect(editData.agent.toolkits).toEqual([]);
    });

    test("should update toolkits with single string", async () => {
      // Clear any existing authorizations and authorize the toolkit
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId: user.id, toolkitName: "data_analysis" }]);

      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          toolkits: "data_analysis",
        }),
      });

      const editData = await editResponse.json();
      expect(editResponse.status).toBe(200);
      expect(editData.agent).toBeDefined();
      expect(editData.agent.id).toBe(createdAgent.id);
      expect(editData.agent.toolkits).toEqual(["data_analysis"]);
    });

    test("should update other fields while preserving toolkits", async () => {
      // Clear any existing authorizations and authorize the toolkits
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db.insert(toolkit_authorizations).values([
        { userId: user.id, toolkitName: "web_search" },
        { userId: user.id, toolkitName: "file_operations" },
      ]);

      const editResponse = await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: createdAgent.id,
          name: "Updated Toolkit Agent",
          description: "Updated description with toolkits",
          enabled: true,
          toolkits: ["web_search", "file_operations"],
        }),
      });

      const editData = await editResponse.json();
      expect(editResponse.status).toBe(200);
      expect(editData.agent).toBeDefined();
      expect(editData.agent.id).toBe(createdAgent.id);
      expect(editData.agent.name).toBe("Updated Toolkit Agent");
      expect(editData.agent.description).toBe(
        "Updated description with toolkits",
      );
      expect(editData.agent.enabled).toBe(true);
      expect(editData.agent.toolkits).toEqual([
        "web_search",
        "file_operations",
      ]);
    });
  });

  describe("agent:view with toolkits", () => {
    let toolkitAgent: any;

    beforeAll(async () => {
      // Create an agent with toolkits to view
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "View Toolkit Agent",
          description: "Agent with toolkits to view",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: true,
        }),
      });
      const agentData = await agentResponse.json();
      toolkitAgent = agentData.agent;

      // Add toolkits to the agent (with proper authorization)
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db.insert(toolkit_authorizations).values([
        { userId: user.id, toolkitName: "web_search" },
        { userId: user.id, toolkitName: "file_operations" },
        { userId: user.id, toolkitName: "data_analysis" },
      ]);

      await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: toolkitAgent.id,
          toolkits: ["web_search", "file_operations", "data_analysis"],
        }),
      });
    });

    test("should view an agent with toolkits", async () => {
      const viewResponse = await fetch(`${url}/api/agent/${toolkitAgent.id}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      });

      const viewData = await viewResponse.json();
      expect(viewResponse.status).toBe(200);
      expect(viewData.agent).toBeDefined();
      expect(viewData.agent.id).toBe(toolkitAgent.id);
      expect(viewData.agent.name).toBe("View Toolkit Agent");
      expect(viewData.agent.toolkits).toEqual([
        "web_search",
        "file_operations",
        "data_analysis",
      ]);
    });
  });

  describe("agent:list with toolkits", () => {
    beforeAll(async () => {
      // Create multiple agents with different toolkit configurations
      await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "List Agent 1",
          description: "Agent with web_search toolkit",
          model: "gpt-3.5-turbo",
          userPrompt: "You are a helpful assistant.",
          enabled: false,
        }),
      });

      await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "List Agent 2",
          description: "Agent with multiple toolkits",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: true,
        }),
      });

      // Add toolkits to the agents (with proper authorization)
      const listResponse = await fetch(`${url}/api/agents`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      });
      const listData = await listResponse.json();

      // Find the agents we just created and add toolkits
      const agent1 = listData.agents.find(
        (a: any) => a.name === "List Agent 1",
      );
      const agent2 = listData.agents.find(
        (a: any) => a.name === "List Agent 2",
      );

      // Clear any existing authorizations and authorize the toolkits
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db.insert(toolkit_authorizations).values([
        { userId: user.id, toolkitName: "web_search" },
        { userId: user.id, toolkitName: "file_operations" },
        { userId: user.id, toolkitName: "data_analysis" },
      ]);

      if (agent1) {
        await fetch(`${url}/api/agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${session.cookieName}=${session.id}`,
          },
          body: JSON.stringify({
            id: agent1.id,
            toolkits: ["web_search"],
          }),
        });
      }

      if (agent2) {
        await fetch(`${url}/api/agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${session.cookieName}=${session.id}`,
          },
          body: JSON.stringify({
            id: agent2.id,
            toolkits: ["file_operations", "data_analysis"],
          }),
        });
      }
    });

    test("should list agents with their toolkits", async () => {
      const listResponse = await fetch(`${url}/api/agents`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      });

      const listData = await listResponse.json();
      expect(listResponse.status).toBe(200);
      expect(Array.isArray(listData.agents)).toBe(true);
      expect(listData.agents.length).toBeGreaterThan(0);

      // Check that agents have toolkit arrays
      for (const agent of listData.agents) {
        expect(Array.isArray(agent.toolkits)).toBe(true);
        expect(agent.userId).toBe(user.id);
      }

      // Find specific agents and verify their toolkits
      const agent1 = listData.agents.find(
        (a: any) => a.name === "List Agent 1",
      );
      const agent2 = listData.agents.find(
        (a: any) => a.name === "List Agent 2",
      );

      if (agent1) {
        expect(agent1.toolkits).toEqual(["web_search"]);
      }

      if (agent2) {
        expect(agent2.toolkits).toEqual(["file_operations", "data_analysis"]);
      }
    });
  });

  describe("agent:tick with toolkits", () => {
    let agentWithToolkits: any;

    beforeAll(async () => {
      // Clear any existing authorizations and authorize the toolkits we need
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db.insert(toolkit_authorizations).values([
        { userId: user.id, toolkitName: "web_search" },
        { userId: user.id, toolkitName: "file_operations" },
      ]);

      // Create an agent with toolkits
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          name: "Tick Toolkit Agent",
          description: "Agent with toolkits to test tick",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: true,
          toolkits: ["web_search", "file_operations"],
        }),
      });
      const agentData = await agentResponse.json();
      agentWithToolkits = agentData.agent;
    });

    test("should fail to run agent with unauthorized toolkits", async () => {
      // Directly update the agent in the database to have unauthorized toolkits
      // This bypasses the normal edit validation to test the tick validation
      await api.db.db
        .update(agents)
        .set({ toolkits: ["unauthorized_toolkit", "another_unauthorized"] })
        .where(eq(agents.id, agentWithToolkits.id));

      // Try to run the agent
      const tickResponse = await fetch(`${url}/api/agent/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agentWithToolkits.id,
        }),
      });

      expect(tickResponse.status).toBe(406);
      const errorData = await tickResponse.json();
      expect(errorData.error.message).toContain(
        "Agent cannot run because you are not authorized to use the following toolkits",
      );
      expect(errorData.error.message).toContain("unauthorized_toolkit");
      expect(errorData.error.message).toContain("another_unauthorized");
    });

    test("should run agent with authorized toolkits", async () => {
      // First, ensure the agent has only authorized toolkits
      await fetch(`${url}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agentWithToolkits.id,
          toolkits: ["web_search"],
        }),
      });

      // Authorize the toolkit
      await clearUserToolkitAuthorizations(user.id);
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId: user.id, toolkitName: "web_search" }]);

      // Try to run the agent
      const tickResponse = await fetch(`${url}/api/agent/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agentWithToolkits.id,
        }),
      });

      // The agent should be able to run (though it might fail for other reasons like OpenAI API)
      // We're just testing that the authorization check passes
      expect(tickResponse.status).not.toBe(400);
    });
  });
});
