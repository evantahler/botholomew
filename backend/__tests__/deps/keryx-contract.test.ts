import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Action, api } from "keryx";
import { z } from "zod";
import { HOOK_TIMEOUT } from "../setup";

/**
 * Facts about Keryx that the durable bot loop is designed around, asserted
 * against the installed version so a bump that changes one fails here rather
 * than as a lost or doubled tick in production.
 *
 * Two of the facts are exercisable without a bot loop, and they are the two
 * that are easy to forget at a call site:
 *
 * 1. **A one-off `enqueue` is not deduplicated.** Enqueue the same job twice
 *    and two jobs exist. Single-flight therefore has to come from a Postgres
 *    lease, never from the queue. (A *recurring* action is the exception: its
 *    job wrapper carries node-resque's `QueueLock`, so a second identical
 *    enqueue is refused — asserted below too, because "Keryx dedupes" is true
 *    of exactly one kind of action and that kind is not a tick.)
 * 2. **`enqueueIn` without a queue lands on `"default"`**, whatever queue the
 *    action itself declares. `enqueue` falls back to the action's queue;
 *    `enqueueIn` and `enqueueAt` do not. Every delayed enqueue passes its queue.
 *
 * The other four — no retry of a failed or crashed job, no session on a task
 * connection, a five-minute default action timeout, and fire-and-forget PubSub
 * forwarded to MCP sessions — are recorded with file and line in the phase doc
 * that verified them.
 *
 * Jobs go to a queue no worker drains, so nothing here races the test
 * environment's task processor, and every queue touched is emptied afterwards.
 */

/** A queue none of `config.tasks.queues` names, so no worker takes from it. */
const UNDRAINED_QUEUE = "keryx-contract";

/**
 * A one-off task action — a `task` with no `frequency` — the shape a
 * conversation tick has. Registered only for the duration of this file.
 */
class ContractProbe implements Action {
  name = "keryx-contract:probe";
  description = "Test-only one-off task used to observe enqueue behaviour.";
  inputs = z.object({ marker: z.string() });
  task = { queue: UNDRAINED_QUEUE };

  /**
   * Never performed: its jobs sit on a queue no worker drains.
   * @returns Nothing.
   */
  async run() {
    return {};
  }
}

const probe = new ContractProbe();

beforeAll(async () => {
  await api.start();
  api.actions.actions.push(probe);
}, HOOK_TIMEOUT);

afterAll(async () => {
  api.actions.actions = api.actions.actions.filter((a) => a !== probe);
  await api.resque.queue.delQueue(UNDRAINED_QUEUE);
  await api.stop();
}, HOOK_TIMEOUT);

describe("keryx enqueue contract", () => {
  test("a one-off enqueue is not deduplicated: twice is two jobs", async () => {
    await api.resque.queue.delQueue(UNDRAINED_QUEUE);

    const first = await api.actions.enqueue(probe.name, { marker: "same" });
    const second = await api.actions.enqueue(probe.name, { marker: "same" });

    expect(first).toBe(true);
    expect(second).toBe(true);
    // The action's own queue is where `enqueue` put them, with no queue named.
    expect(await api.resque.queue.length(UNDRAINED_QUEUE)).toBe(2);
  });

  test("a recurring action is the one kind that is deduplicated", async () => {
    // `invites:sweep` has a `frequency`, so its job carries `QueueLock`: an
    // identical job already waiting on the queue refuses the second enqueue.
    // Sent to the undrained queue so the worker cannot consume the first one
    // between the two calls and make the second legitimately succeed.
    await api.resque.queue.delQueue(UNDRAINED_QUEUE);
    const args = { marker: "recurring" };

    const first = await api.actions.enqueue(
      "invites:sweep",
      args,
      UNDRAINED_QUEUE,
    );
    const second = await api.actions.enqueue(
      "invites:sweep",
      args,
      UNDRAINED_QUEUE,
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await api.resque.queue.length(UNDRAINED_QUEUE)).toBe(1);

    await api.resque.queue.delQueue(UNDRAINED_QUEUE);
    await api.resque.queue.connection.redis.del(
      api.resque.queue.connection.key(
        "lock",
        "invites:sweep",
        UNDRAINED_QUEUE,
        JSON.stringify([args]),
      ),
    );
  });

  test("enqueueIn without a queue lands on default, not the action's queue", async () => {
    const args = { marker: "delayed" };
    try {
      // An hour out, so no scheduler promotes it while the test looks.
      await api.actions.enqueueIn(60 * 60_000, probe.name, args);

      const delayed = Object.values(await api.resque.queue.allDelayed())
        .flat()
        .filter(
          (job) =>
            job.class === probe.name &&
            (job.args?.[0] as { marker?: string })?.marker === "delayed",
        );

      // Exactly one, on `default` — the action declares `keryx-contract`.
      expect(delayed.map((job) => job.queue)).toEqual(["default"]);
    } finally {
      await api.resque.queue.delDelayed("default", probe.name, [args]);
    }
  });
});
