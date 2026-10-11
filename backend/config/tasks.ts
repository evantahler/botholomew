import { loadFromEnvIfSet } from "keryx";
export const configTasks = {
  enabled: await loadFromEnvIfSet("TASKS_ENABLED", true),
  // What queues should the taskProcessors work?
  // Order controls worker priority: workers drain queues left-to-right.
  //
  // The order here is load-bearing, not alphabetical. `bots` holds
  // conversation ticks, which are the work a person may be sitting in front of
  // a thread waiting for, so it drains first. That cannot starve the clocks
  // behind it: a tick is enqueued only for a conversation whose lease it holds,
  // so the depth of `bots` is bounded by the lease slots the concurrency caps
  // allow, not by how much work is waiting. `orchestrator` holds the cheap
  // reconciling clocks — dispatch, reap, expiry — which read rows and decide
  // what happens next. `default` is everything unhurried: the invite and audit
  // retention sweeps.
  //
  // This is an explicit list rather than `["*"]` because `["*"]` means equal
  // priority, which is precisely the starvation case.
  queues: ["bots", "orchestrator", "default"] as
    | string[]
    | (() => Promise<string[]>),
  // Or, rather than providing a static list of `queues`, you can define a method that returns the list of queues.
  // queues: async () => { return ["queueA", "queueB"]; } as string[] | (() => Promise<string[]>)>,
  // how long to sleep between jobs / scheduler checks
  timeout: await loadFromEnvIfSet("TASK_TIMEOUT", 5000),
  // how many parallel workers we run?
  taskProcessors: await loadFromEnvIfSet(
    "TASK_PROCESSORS",
    Bun.env.NODE_ENV === "test" ? 0 : 1,
  ),
  // how often should we check the event loop to spawn more taskProcessors?
  checkTimeout: 500,
  // how many ms would constitute an event loop delay to halt taskProcessors spawning?
  maxEventLoopDelay: 5,
  // how long before we mark a resque worker / task processor as stuck/dead?
  stuckWorkerTimeout: 1000 * 60 * 60,
  // should the scheduler automatically try to retry failed tasks which were failed due to being 'stuck'?
  retryStuckJobs: false,
};
