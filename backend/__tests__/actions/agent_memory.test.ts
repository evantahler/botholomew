import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgentCreate } from "../../actions/agent";
import type {
  AgentMemoryCreate,
  AgentMemoryDelete,
  AgentMemoryEdit,
  AgentMemoryList,
  AgentMemoryView,
} from "../../actions/agent_memory";
import type { SessionCreate } from "../../actions/session";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import {
  createAgent,
  createUserAndSession,
  TEST_AGENTS,
  USERS,
} from "../utils/testHelpers";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
});

afterAll(async () => {
  await api.stop();
});

describe("agent:memory:create", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let agent: ActionResponse<AgentCreate>["agent"];

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
    agent = await createAgent(testSession, TEST_AGENTS.BASIC);
  });

  test("should create a memory successfully", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "test_preference",
        content: "User prefers concise responses",
        memoryType: "fact",
      }),
    });

    const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
    expect(response.status).toBe(200);
    expect(data.memory).toBeDefined();
    expect(data.memory.key).toBe("test_preference");
    expect(data.memory.content).toBe("User prefers concise responses");
    expect(data.memory.memoryType).toBe("fact");
    expect(data.memory.agentId).toBe(agent.id);
    expect(data.memory.expiresAt).toBeNull();
  });

  test("should create memory with expiration date", async () => {
    const expiresAt = new Date(Date.now() + 86400000); // 24 hours from now
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "temporary_note",
        content: "This is a temporary memory",
        memoryType: "context",
        expiresAt: expiresAt.toISOString(),
      }),
    });

    const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
    expect(response.status).toBe(200);
    expect(data.memory).toBeDefined();
    expect(data.memory.expiresAt).toBeDefined();
  });

  test("should create memory with different types", async () => {
    const types = ["fact", "conversation", "result", "context"] as const;

    for (const type of types) {
      const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          key: `test_${type}`,
          content: `Test ${type} memory`,
          memoryType: type,
        }),
      });

      const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
      expect(response.status).toBe(200);
      expect(data.memory.memoryType).toBe(type);
    }
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: agent.id,
        key: "test",
        content: "test",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("should validate required fields", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "test",
        // Missing content
      }),
    });

    expect(response.status).toBe(406);
  });

  test("should not allow creating memory for another user's agent", async () => {
    const otherSession = await createUserAndSession({
      name: "Other User",
      email: "other@example.com",
      password: "password123",
    });
    const otherAgent = await createAgent(otherSession, TEST_AGENTS.BASIC);

    const response = await fetch(`${url}/api/agent/${otherAgent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: otherAgent.id,
        key: "hack",
        content: "hacked",
      }),
    });

    expect(response.status).toBe(406);
  });
});

describe("agent:memory:list", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let agent: ActionResponse<AgentCreate>["agent"];
  let memoryIds: number[] = [];

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.LUIGI);
    user = testSession.user;
    session = testSession.session;
    agent = await createAgent(testSession, TEST_AGENTS.BASIC);

    // Create multiple memories
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          key: `memory_${i}`,
          content: `Memory content ${i}`,
          memoryType: i % 2 === 0 ? "fact" : "conversation",
        }),
      });
      const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
      memoryIds.push(data.memory.id);
    }
  });

  test("should list all memories for an agent", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memories`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    const data = (await response.json()) as ActionResponse<AgentMemoryList>;
    expect(response.status).toBe(200);
    expect(Array.isArray(data.memories)).toBe(true);
    expect(data.memories.length).toBeGreaterThanOrEqual(5);
    expect(data.total).toBeGreaterThanOrEqual(5);

    for (const memory of data.memories) {
      expect(memory.agentId).toBe(agent.id);
    }
  });

  test("should support pagination", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memories?limit=2&offset=1`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<AgentMemoryList>;
    expect(response.status).toBe(200);
    expect(data.memories.length).toBeLessThanOrEqual(2);
  });

  test("should filter by memory type", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memories?memoryType=fact`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<AgentMemoryList>;
    expect(response.status).toBe(200);
    expect(Array.isArray(data.memories)).toBe(true);

    for (const memory of data.memories) {
      expect(memory.memoryType).toBe("fact");
    }
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memories`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(401);
  });

  test("should not allow listing another user's agent memories", async () => {
    const otherSession = await createUserAndSession({
      name: "Other User 2",
      email: "other2@example.com",
      password: "password123",
    });

    const response = await fetch(`${url}/api/agent/${agent.id}/memories`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
      },
    });

    expect(response.status).toBe(406);
  });
});

describe("agent:memory:view", () => {
  let session: ActionResponse<SessionCreate>["session"];
  let agent: ActionResponse<AgentCreate>["agent"];
  let memory: ActionResponse<AgentMemoryCreate>["memory"];

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.BOWSER);
    session = testSession.session;
    agent = await createAgent(testSession, TEST_AGENTS.BASIC);

    // Create a memory to view
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "view_test",
        content: "Memory to view",
        memoryType: "fact",
      }),
    });
    const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
    memory = data.memory;
  });

  test("should view a memory successfully", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<AgentMemoryView>;
    expect(response.status).toBe(200);
    expect(data.memory).toBeDefined();
    expect(data.memory.id).toBe(memory.id);
    expect(data.memory.key).toBe("view_test");
    expect(data.memory.content).toBe("Memory to view");
  });

  test("should require authentication", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    expect(response.status).toBe(401);
  });

  test("should return not found for non-existent memory", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memory/999999`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(406);
  });
});

describe("agent:memory:edit", () => {
  let session: ActionResponse<SessionCreate>["session"];
  let agent: ActionResponse<AgentCreate>["agent"];
  let memory: ActionResponse<AgentMemoryCreate>["memory"];

  beforeAll(async () => {
    const testSession = await createUserAndSession({
      name: "Edit Memory User",
      email: "edit-memory@example.com",
      password: "password123",
    });
    session = testSession.session;
    agent = await createAgent(testSession, TEST_AGENTS.BASIC);

    // Create a memory to edit
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "edit_test",
        content: "Original content",
        memoryType: "fact",
      }),
    });
    const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
    memory = data.memory;
  });

  test("should edit a memory successfully", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: memory.id,
          key: "updated_key",
          content: "Updated content",
          memoryType: "conversation",
        }),
      },
    );

    const data = (await response.json()) as ActionResponse<AgentMemoryEdit>;
    expect(response.status).toBe(200);
    expect(data.memory).toBeDefined();
    expect(data.memory.id).toBe(memory.id);
    expect(data.memory.key).toBe("updated_key");
    expect(data.memory.content).toBe("Updated content");
    expect(data.memory.memoryType).toBe("conversation");
  });

  test("should allow partial updates", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: memory.id,
          content: "Only content updated",
        }),
      },
    );

    const data = (await response.json()) as ActionResponse<AgentMemoryEdit>;
    expect(response.status).toBe(200);
    expect(data.memory.content).toBe("Only content updated");
  });

  test("should require authentication", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: memory.id,
          content: "Unauthorized update",
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  test("should not allow editing another user's memory", async () => {
    const otherSession = await createUserAndSession({
      name: "Other Edit User",
      email: "other-edit@example.com",
      password: "password123",
    });

    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: memory.id,
          content: "Hacked",
        }),
      },
    );

    expect(response.status).toBe(406);
  });
});

describe("agent:memory:delete", () => {
  let session: ActionResponse<SessionCreate>["session"];
  let agent: ActionResponse<AgentCreate>["agent"];
  let memory: ActionResponse<AgentMemoryCreate>["memory"];

  beforeAll(async () => {
    const testSession = await createUserAndSession({
      name: "Delete Memory User",
      email: "delete-memory@example.com",
      password: "password123",
    });
    session = testSession.session;
    agent = await createAgent(testSession, TEST_AGENTS.BASIC);

    // Create a memory to delete
    const response = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "delete_test",
        content: "Memory to delete",
        memoryType: "fact",
      }),
    });
    const data = (await response.json()) as ActionResponse<AgentMemoryCreate>;
    memory = data.memory;
  });

  test("should delete a memory successfully", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: memory.id,
        }),
      },
    );

    const data = (await response.json()) as ActionResponse<AgentMemoryDelete>;
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify memory is deleted by trying to view it
    const viewResponse = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(viewResponse.status).toBe(406);
  });

  test("should require authentication", async () => {
    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${memory.id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: memory.id,
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  test("should not allow deleting another user's memory", async () => {
    // Create another memory first
    const createResponse = await fetch(`${url}/api/agent/${agent.id}/memory`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        key: "other_delete_test",
        content: "Another memory",
        memoryType: "fact",
      }),
    });
    const createData =
      (await createResponse.json()) as ActionResponse<AgentMemoryCreate>;

    const otherSession = await createUserAndSession({
      name: "Other Delete User",
      email: "other-delete@example.com",
      password: "password123",
    });

    const response = await fetch(
      `${url}/api/agent/${agent.id}/memory/${createData.memory.id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
        },
        body: JSON.stringify({
          id: agent.id,
          memoryId: createData.memory.id,
        }),
      },
    );

    expect(response.status).toBe(406);
  });

  test("should return success false for non-existent memory", async () => {
    const response = await fetch(`${url}/api/agent/${agent.id}/memory/999999`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        id: agent.id,
        memoryId: 999999,
      }),
    });

    const data = (await response.json()) as ActionResponse<AgentMemoryDelete>;
    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
  });
});
