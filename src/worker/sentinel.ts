/**
 * Sentinel arg the compiled binary re-execs itself with to run a background
 * worker (see ../cli.ts and ./spawn.ts). Lives in its own leaf module — with no
 * imports — so both the entrypoint and the spawner can use it without dragging
 * the worker stack into a circular import.
 */
export const WORKER_RUN_SENTINEL = "__botholomew_worker_run__";
