import { and, asc, eq } from "drizzle-orm";
import { api } from "../api";
import { ErrorType, TypedError } from "../classes/TypedError";
import { Agent, agents } from "../models/agent";
import { Workflow, workflows } from "../models/workflow";
import { WorkflowRun, workflow_runs } from "../models/workflow_run";
import {
  WorkflowRunStep,
  workflow_run_steps,
} from "../models/workflow_run_step";
import { WorkflowStep, workflow_steps } from "../models/workflow_step";
import { agentRun, agentRunStreaming } from "./AgentOps";
import type { StreamingChunk } from "../classes/Action";

export function serializeWorkflowRun(workflowRun: WorkflowRun) {
  return {
    id: workflowRun.id,
    workflowId: workflowRun.workflowId,
    status: workflowRun.status,
    input: workflowRun.input,
    output: workflowRun.output,
    error: workflowRun.error,
    currentStep: workflowRun.currentStep,
    startedAt: workflowRun.startedAt?.getTime(),
    completedAt: workflowRun.completedAt?.getTime(),
    metadata: workflowRun.metadata,
  };
}

/**
 * Core workflow processing logic shared between user-facing and system-level actions
 * @param workflowId - The workflow ID
 * @param runId - The workflow run ID
 * @param requireUserOwnership - Whether to check workflow ownership (userId required if true)
 * @param userId - User ID for ownership validation (required if requireUserOwnership is true)
 * @returns Promise<{ workflowRun: ReturnType<typeof serializeWorkflowRun> }>
 */
export async function processWorkflowRunTick(
  workflowId: number,
  runId: number,
  requireUserOwnership: boolean = false,
  userId?: number,
): Promise<{
  workflowRun: ReturnType<typeof serializeWorkflowRun>;
}> {
  const [workflowRun]: WorkflowRun[] = await api.db.db
    .select()
    .from(workflow_runs)
    .where(
      and(
        eq(workflow_runs.id, runId),
        eq(workflow_runs.workflowId, workflowId),
      ),
    )
    .limit(1);

  if (!workflowRun) {
    throw new TypedError({
      message: "Workflow run not found",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  // Build workflow query with optional user ownership check
  const workflowQuery =
    requireUserOwnership && userId
      ? and(
          eq(workflows.id, workflowRun.workflowId),
          eq(workflows.userId, userId),
        )
      : eq(workflows.id, workflowRun.workflowId);

  const [workflow]: Workflow[] = await api.db.db
    .select()
    .from(workflows)
    .where(workflowQuery)
    .limit(1);

  if (!workflow) {
    const message = requireUserOwnership
      ? "Workflow not found or not owned by user"
      : "Workflow not found";
    throw new TypedError({
      message,
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  if (!workflow.enabled) {
    throw new TypedError({
      message: "Workflow is not enabled",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  // Check if workflow run is already completed or failed
  if (workflowRun.status === "completed" || workflowRun.status === "failed") {
    return {
      workflowRun: serializeWorkflowRun(workflowRun),
    };
  }

  // Get all workflow steps ordered by position
  const workflowSteps: WorkflowStep[] = await api.db.db
    .select()
    .from(workflow_steps)
    .where(eq(workflow_steps.workflowId, workflowRun.workflowId))
    .orderBy(asc(workflow_steps.position));

  if (workflowSteps.length === 0) {
    return {
      workflowRun: serializeWorkflowRun(workflowRun),
    };
  }

  const thisStep = workflowSteps[workflowRun.currentStep];
  const previousStep = workflowSteps[workflowRun.currentStep - 1];

  if (!thisStep) {
    await api.db.db
      .update(workflow_runs)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(workflow_runs.id, workflowRun.id));

    return {
      workflowRun: serializeWorkflowRun(workflowRun),
    };
  }

  const [agent]: Agent[] = await api.db.db
    .select()
    .from(agents)
    .where(eq(agents.id, thisStep.agentId))
    .limit(1);

  if (!agent) {
    throw new Error(`Agent with id ${thisStep.agentId} not found`);
  }

  // delete a stale workflow run step
  await api.db.db
    .delete(workflow_run_steps)
    .where(
      and(
        eq(workflow_run_steps.workflowRunId, workflowRun.id),
        eq(workflow_run_steps.workflowStepId, thisStep.id),
      ),
    );

  const [previousWorkflowRunStep]: WorkflowRunStep[] = await api.db.db
    .select()
    .from(workflow_run_steps)
    .where(
      and(
        eq(workflow_run_steps.workflowRunId, workflowRun.id),
        eq(
          workflow_run_steps.workflowStepId,
          previousStep ? previousStep.id : -1,
        ),
      ),
    )
    .limit(1);

  const input = previousWorkflowRunStep?.output ?? workflowRun.input;

  const [workflowRunStep]: WorkflowRunStep[] = await api.db.db
    .insert(workflow_run_steps)
    .values({
      workflowRunId: workflowRun.id,
      workflowStepId: thisStep.id,
      systemPrompt: agent.systemPrompt,
      userPrompt: agent.userPrompt,
      input: input,
      output: null,
      rationale: null,
      responseType: agent.responseType,
      status: "pending",
      workflowId: workflowRun.workflowId,
    })
    .returning();

  await api.db.db
    .update(workflow_run_steps)
    .set({ status: "running" })
    .where(eq(workflow_run_steps.id, workflowRunStep.id));

  try {
    const stepResult = await agentRun(
      agent,
      workflowRunStep,
      input ? input : undefined,
    );

    // Update step status to completed and fetch the updated workflow run
    const [updatedWorkflowRun] = await api.db.db
      .update(workflow_runs)
      .set({
        currentStep: workflowRun.currentStep + 1,
        status:
          workflowRun.status === "pending" ? "running" : workflowRun.status,
        startedAt:
          workflowRun.status === "pending" ? new Date() : workflowRun.startedAt,
      })
      .where(eq(workflow_runs.id, workflowRun.id))
      .returning();

    // Update the workflow run step status
    await api.db.db
      .update(workflow_run_steps)
      .set({
        status: stepResult.status,
        output: stepResult.result,
        rationale: stepResult.rationale,
      })
      .where(eq(workflow_run_steps.id, workflowRunStep.id));

    return {
      workflowRun: serializeWorkflowRun(updatedWorkflowRun),
    };
  } catch (error) {
    // Mark step as failed
    await api.db.db
      .update(workflow_run_steps)
      .set({
        status: "failed",
        output: String(error),
      })
      .where(eq(workflow_run_steps.id, workflowRunStep.id));

    // Mark workflow run as failed
    await api.db.db
      .update(workflow_runs)
      .set({
        status: "failed",
        error: String(error),
        completedAt: new Date(),
      })
      .where(eq(workflow_runs.id, workflowRun.id));

    throw new TypedError({
      message: `Step execution failed: ${error}`,
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }
}

/**
 * Streaming version of processWorkflowRunTick that sends incremental updates via callback.
 * Streams step execution results in real-time.
 */
export async function processWorkflowRunTickStreaming(
  workflowId: number,
  runId: number,
  onChunk: (chunk: StreamingChunk) => Promise<void>,
  messageId: string | number,
  requireUserOwnership: boolean = false,
  userId?: number,
): Promise<void> {
  const [workflowRun]: WorkflowRun[] = await api.db.db
    .select()
    .from(workflow_runs)
    .where(
      and(
        eq(workflow_runs.id, runId),
        eq(workflow_runs.workflowId, workflowId),
      ),
    )
    .limit(1);

  if (!workflowRun) {
    throw new TypedError({
      message: "Workflow run not found",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  // Build workflow query with optional user ownership check
  const workflowQuery =
    requireUserOwnership && userId
      ? and(
          eq(workflows.id, workflowRun.workflowId),
          eq(workflows.userId, userId),
        )
      : eq(workflows.id, workflowRun.workflowId);

  const [workflow]: Workflow[] = await api.db.db
    .select()
    .from(workflows)
    .where(workflowQuery)
    .limit(1);

  if (!workflow) {
    const message = requireUserOwnership
      ? "Workflow not found or not owned by user"
      : "Workflow not found";
    throw new TypedError({
      message,
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  if (!workflow.enabled) {
    throw new TypedError({
      message: "Workflow is not enabled",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  // Check if workflow run is already completed or failed
  if (workflowRun.status === "completed" || workflowRun.status === "failed") {
    await onChunk({
      messageId,
      type: "stream:chunk",
      data: {
        status: workflowRun.status,
        message: `Workflow run already ${workflowRun.status}`,
        workflowRun: serializeWorkflowRun(workflowRun),
      },
    });
    return;
  }

  // Send workflow start message
  await onChunk({
    messageId,
    type: "stream:chunk",
    data: {
      status: "starting",
      message: "Starting workflow step execution",
      workflowRun: serializeWorkflowRun(workflowRun),
    },
  });

  // Get all workflow steps ordered by position
  const workflowSteps: WorkflowStep[] = await api.db.db
    .select()
    .from(workflow_steps)
    .where(eq(workflow_steps.workflowId, workflowRun.workflowId))
    .orderBy(asc(workflow_steps.position));

  if (workflowSteps.length === 0) {
    await onChunk({
      messageId,
      type: "stream:chunk",
      data: {
        status: "completed",
        message: "No steps to execute",
        workflowRun: serializeWorkflowRun(workflowRun),
      },
    });
    return;
  }

  const thisStep = workflowSteps[workflowRun.currentStep];
  const previousStep = workflowSteps[workflowRun.currentStep - 1];

  if (!thisStep) {
    await api.db.db
      .update(workflow_runs)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(workflow_runs.id, workflowRun.id));

    const [completedRun]: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.id, workflowRun.id))
      .limit(1);

    await onChunk({
      messageId,
      type: "stream:chunk",
      data: {
        status: "completed",
        message: "Workflow completed",
        workflowRun: serializeWorkflowRun(completedRun!),
      },
    });
    return;
  }

  const [agent]: Agent[] = await api.db.db
    .select()
    .from(agents)
    .where(eq(agents.id, thisStep.agentId))
    .limit(1);

  if (!agent) {
    throw new Error(`Agent with id ${thisStep.agentId} not found`);
  }

  // Send step start message
  await onChunk({
    messageId,
    type: "stream:chunk",
    data: {
      status: "step_starting",
      message: `Starting step ${workflowRun.currentStep + 1}/${workflowSteps.length}`,
      stepIndex: workflowRun.currentStep,
      stepId: thisStep.id,
      agentId: agent.id,
      agentName: agent.name,
    },
  });

  // delete a stale workflow run step
  await api.db.db
    .delete(workflow_run_steps)
    .where(
      and(
        eq(workflow_run_steps.workflowRunId, workflowRun.id),
        eq(workflow_run_steps.workflowStepId, thisStep.id),
      ),
    );

  const [previousWorkflowRunStep]: WorkflowRunStep[] = await api.db.db
    .select()
    .from(workflow_run_steps)
    .where(
      and(
        eq(workflow_run_steps.workflowRunId, workflowRun.id),
        eq(
          workflow_run_steps.workflowStepId,
          previousStep ? previousStep.id : -1,
        ),
      ),
    )
    .limit(1);

  const input = previousWorkflowRunStep?.output ?? workflowRun.input;

  const [workflowRunStep]: WorkflowRunStep[] = await api.db.db
    .insert(workflow_run_steps)
    .values({
      workflowRunId: workflowRun.id,
      workflowStepId: thisStep.id,
      systemPrompt: agent.systemPrompt,
      userPrompt: agent.userPrompt,
      input: input,
      output: null,
      rationale: null,
      responseType: agent.responseType,
      status: "pending",
      workflowId: workflowRun.workflowId,
    })
    .returning();

  await api.db.db
    .update(workflow_run_steps)
    .set({ status: "running" })
    .where(eq(workflow_run_steps.id, workflowRunStep.id));

  try {
    // Use streaming agent run
    let stepOutput = "";
    let stepRationale: string | undefined = undefined;
    let stepStatus: "completed" | "failed" = "completed";

    await agentRunStreaming(
      agent,
      async (chunk: StreamingChunk) => {
        // Forward agent streaming chunks with step context
        if (chunk.type === "stream:chunk" && chunk.data) {
          if (chunk.data.accumulated) {
            stepOutput = chunk.data.accumulated;
          } else if (chunk.data.chunk) {
            stepOutput += chunk.data.chunk;
          }

          // Forward chunk with step context
          await onChunk({
            messageId,
            type: "stream:chunk",
            data: {
              ...chunk.data,
              stepIndex: workflowRun.currentStep,
              stepId: workflowRunStep.id,
              stepOutput: stepOutput,
            },
          });
        } else if (chunk.type === "stream:done" || chunk.type === "stream:error") {
          // Capture final result
          if (chunk.data?.result) {
            stepOutput = chunk.data.result;
          }
          if (chunk.data?.rationale) {
            stepRationale = chunk.data.rationale;
          }
          if (chunk.data?.status === "failed" || chunk.type === "stream:error") {
            stepStatus = "failed";
          }

          // Forward completion/error
          await onChunk({
            messageId,
            type: chunk.type,
            data: {
              ...chunk.data,
              stepIndex: workflowRun.currentStep,
              stepId: workflowRunStep.id,
              stepOutput: stepOutput,
            },
            error: chunk.error,
          });
        }
      },
      messageId,
      workflowRunStep,
      input ? input : undefined,
    );

    // Update step status to completed
    await api.db.db
      .update(workflow_run_steps)
      .set({
        status: stepStatus,
        output: stepOutput,
        rationale: stepRationale,
      })
      .where(eq(workflow_run_steps.id, workflowRunStep.id));

    // Update workflow run
    const [updatedWorkflowRun] = await api.db.db
      .update(workflow_runs)
      .set({
        currentStep: workflowRun.currentStep + 1,
        status:
          workflowRun.status === "pending" ? "running" : workflowRun.status,
        startedAt:
          workflowRun.status === "pending" ? new Date() : workflowRun.startedAt,
      })
      .where(eq(workflow_runs.id, workflowRun.id))
      .returning();

    // Send step completion message
    await onChunk({
      messageId,
      type: "stream:chunk",
      data: {
        status: "step_completed",
        message: `Step ${workflowRun.currentStep + 1} completed`,
        stepIndex: workflowRun.currentStep,
        stepId: workflowRunStep.id,
        stepOutput: stepOutput,
        stepRationale: stepRationale,
        workflowRun: serializeWorkflowRun(updatedWorkflowRun),
      },
    });

    // Check if workflow is complete
    if (!workflowSteps[updatedWorkflowRun.currentStep]) {
      await api.db.db
        .update(workflow_runs)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(workflow_runs.id, workflowRun.id));

      const [completedRun]: WorkflowRun[] = await api.db.db
        .select()
        .from(workflow_runs)
        .where(eq(workflow_runs.id, workflowRun.id))
        .limit(1);

      await onChunk({
        messageId,
        type: "stream:chunk",
        data: {
          status: "completed",
          message: "Workflow completed",
          workflowRun: serializeWorkflowRun(completedRun!),
        },
      });
    }
  } catch (error) {
    // Mark step as failed
    await api.db.db
      .update(workflow_run_steps)
      .set({
        status: "failed",
        output: String(error),
      })
      .where(eq(workflow_run_steps.id, workflowRunStep.id));

    // Mark workflow run as failed
    await api.db.db
      .update(workflow_runs)
      .set({
        status: "failed",
        error: String(error),
        completedAt: new Date(),
      })
      .where(eq(workflow_runs.id, workflowRun.id));

    const [failedRun]: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.id, workflowRun.id))
      .limit(1);

    await onChunk({
      messageId,
      type: "stream:error",
      error: {
        message: `Step execution failed: ${error}`,
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        timestamp: new Date().getTime(),
      },
      data: {
        status: "failed",
        workflowRun: serializeWorkflowRun(failedRun!),
      },
    });

    throw new TypedError({
      message: `Step execution failed: ${error}`,
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }
}
