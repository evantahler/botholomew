import { and, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { api } from "../api";
import { agent_memories, AgentMemory } from "../models/agent_memory";
import { WorkflowRunStep } from "../models/workflow_run_step";

export function serializeAgentMemory(memory: AgentMemory) {
  return {
    id: memory.id,
    agentId: memory.agentId,
    key: memory.key,
    content: memory.content,
    memoryType: memory.memoryType,
    workflowRunId: memory.workflowRunId,
    metadata: memory.metadata,
    expiresAt: memory.expiresAt ? memory.expiresAt.getTime() : null,
    createdAt: memory.createdAt.getTime(),
    updatedAt: memory.updatedAt.getTime(),
  };
}

/**
 * Format memories for injection into agent context
 */
export function formatMemoriesForContext(memories: AgentMemory[]): string {
  if (memories.length === 0) return "";

  return memories
    .map((m) => {
      const typePrefix = m.memoryType !== "fact" ? `[${m.memoryType}] ` : "";
      return `${typePrefix}${m.key}: ${m.content}`;
    })
    .join("\n");
}

/**
 * Retrieve relevant memories for an agent, excluding expired ones
 */
export async function getRelevantMemories(
  agentId: number,
  limit: number = 10,
  memoryTypes?: string[],
): Promise<AgentMemory[]> {
  const now = new Date();

  // Build where conditions
  const whereConditions = [
    eq(agent_memories.agentId, agentId),
    or(isNull(agent_memories.expiresAt), gt(agent_memories.expiresAt, now)),
  ];

  // Apply memory type filter if provided
  if (memoryTypes && memoryTypes.length > 0) {
    whereConditions.push(
      // @ts-ignore - drizzle doesn't have great type support for IN queries with enums
      or(
        ...memoryTypes.map((type) =>
          eq(
            agent_memories.memoryType,
            type as "fact" | "conversation" | "result" | "context",
          ),
        ),
      ),
    );
  }

  const memories: AgentMemory[] = await api.db.db
    .select()
    .from(agent_memories)
    .where(and(...whereConditions))
    .orderBy(desc(agent_memories.createdAt))
    .limit(limit);

  return memories;
}

/**
 * Auto-create memory from a successful agent run
 */
export async function createMemoryFromRun(
  agentId: number,
  workflowRunStep: WorkflowRunStep,
  autoKey?: string,
): Promise<AgentMemory | null> {
  // Only create memories from successful runs with output
  if (
    workflowRunStep.status !== "completed" ||
    !workflowRunStep.output ||
    workflowRunStep.output.trim().length === 0
  ) {
    return null;
  }

  const key = autoKey || `run_${workflowRunStep.id}`;

  const [memory]: AgentMemory[] = await api.db.db
    .insert(agent_memories)
    .values({
      agentId,
      key,
      content: workflowRunStep.output,
      memoryType: "result",
      workflowRunId: workflowRunStep.workflowRunId,
      metadata: {
        workflowStepId: workflowRunStep.workflowStepId,
        autoCreated: true,
      },
    })
    .returning();

  return memory;
}

/**
 * Clean up expired memories (can be called periodically)
 */
export async function cleanupExpiredMemories(): Promise<number> {
  const now = new Date();
  const result = await api.db.db.delete(agent_memories).where(
    and(
      // Only delete if expiresAt is not null AND it's in the past
      isNotNull(agent_memories.expiresAt),
      lt(agent_memories.expiresAt, now),
    ),
  );

  return result.rowCount ?? 0;
}
