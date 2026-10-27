import ansis from "ansis";
import type { Command } from "commander";
import { decideAndRequeue } from "../approvals/decide.ts";
import {
  APPROVAL_STATUSES,
  type Approval,
  type ApprovalStatus,
} from "../approvals/schema.ts";
import { getApproval, listApprovals } from "../approvals/store.ts";
import { logger } from "../utils/logger.ts";

function statusColor(status: ApprovalStatus): string {
  switch (status) {
    case "approved":
      return ansis.green(status);
    case "denied":
      return ansis.red(status);
    case "pending":
      return ansis.yellow(status);
  }
}

function printApproval(a: Approval) {
  console.log(
    `${ansis.bold(a.id.slice(0, 8))}  ${statusColor(a.status).padEnd(18)}  ${ansis.cyan(`${a.server}/${a.tool}`)}`,
  );
  console.log(`  args: ${a.args}`);
  if (a.task_id) console.log(`  task: ${a.task_id}`);
  if (a.reason) console.log(`  reason: ${a.reason}`);
  console.log(`  created: ${a.created_at}`);
  if (a.decided_at) {
    console.log(`  decided: ${a.decided_at} by ${a.decided_by ?? "?"}`);
  }
}

export function registerApprovalCommand(program: Command) {
  const approval = program
    .command("approval")
    .description("Review and decide pending mcpx tool-call approvals");

  approval
    .command("list")
    .description("List approval requests (newest first)")
    .option(
      "-s, --status <status>",
      `filter by status (${APPROVAL_STATUSES.join("|")})`,
    )
    .option("-l, --limit <n>", "max number of approvals", Number.parseInt)
    .option("-o, --offset <n>", "skip first N approvals", Number.parseInt)
    .action(
      async (opts: {
        status?: ApprovalStatus;
        limit?: number;
        offset?: number;
      }) => {
        if (opts.status && !APPROVAL_STATUSES.includes(opts.status)) {
          logger.error(
            `Unknown status: ${opts.status}. Use one of: ${APPROVAL_STATUSES.join(", ")}`,
          );
          process.exit(1);
        }
        const dir = program.opts().dir;
        const approvals = await listApprovals(dir, {
          status: opts.status,
          limit: opts.limit,
          offset: opts.offset,
        });
        if (approvals.length === 0) {
          logger.dim("No approvals found.");
          return;
        }
        for (const a of approvals) {
          printApproval(a);
          console.log("");
        }
        console.log(ansis.dim(`${approvals.length} approval(s)`));
      },
    );

  approval
    .command("view <id>")
    .description("Show a single approval request")
    .action(async (id: string) => {
      const dir = program.opts().dir;
      const a = await getApproval(dir, id);
      if (!a) {
        logger.error(`No approval found with id ${id}.`);
        process.exit(1);
      }
      printApproval(a);
    });

  approval
    .command("approve <id>")
    .description("Approve a pending request and re-queue its task")
    .action(async (id: string) => {
      const dir = program.opts().dir;
      const a = await getApproval(dir, id);
      if (!a) {
        logger.error(`No approval found with id ${id}.`);
        process.exit(1);
      }
      if (a.status !== "pending") {
        logger.warn(`Approval ${id} is already ${a.status}.`);
        return;
      }
      await decideAndRequeue(dir, id, "approved", "cli");
      logger.success(`Approved ${a.server}/${a.tool} (${id}).`);
      if (a.task_id) logger.dim(`Re-queued task ${a.task_id} (now pending).`);
    });

  approval
    .command("deny <id>")
    .description("Deny a pending request and re-queue its task to recover")
    .action(async (id: string) => {
      const dir = program.opts().dir;
      const a = await getApproval(dir, id);
      if (!a) {
        logger.error(`No approval found with id ${id}.`);
        process.exit(1);
      }
      if (a.status !== "pending") {
        logger.warn(`Approval ${id} is already ${a.status}.`);
        return;
      }
      await decideAndRequeue(dir, id, "denied", "cli");
      logger.success(`Denied ${a.server}/${a.tool} (${id}).`);
      if (a.task_id) logger.dim(`Re-queued task ${a.task_id} (now pending).`);
    });
}
