import { sql } from "drizzle-orm";
import { Action, api, HTTP_METHOD } from "keryx";
import { z } from "zod";
import packageJSON from "../package.json";

export class Status implements Action {
  name = "status";
  description =
    "Returns server health and runtime information including the server name, process ID, package version, uptime in milliseconds, memory consumption in MB, and dependency health checks for the database and Redis. Does not require authentication.";
  inputs = z.object({});
  web = { route: "/status", method: HTTP_METHOD.GET };
  /**
   * Keep load-balancer probes out of Sentry traces. `@keryxjs/sentry` skips
   * the action span and the HTTP transaction when this is `false`; errors and
   * the per-action count metric still fire. This overrides Keryx's built-in
   * `status` action, so the flag has to live here or health checks become
   * transactions the moment traces are turned on.
   */
  tracing = false;

  /**
   * Report process facts and whether Postgres (with the current schema) and
   * Redis answer.
   * @returns The server name, pid, version, uptime, memory, and health checks.
   */
  async run() {
    const consumedMemoryMB =
      Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;

    let databaseHealthy = false;
    try {
      if (api.db?.db) {
        // Touch the newest column in the schema, not just `SELECT NOW()`. The
        // web server binds before `DATABASE_AUTO_MIGRATE` finishes, so a bare
        // clock query would report healthy against an empty schema — exactly
        // the race e2e global-setup and load balancers must not trust. A
        // migration that adds a newer column moves this probe to it.
        await api.db.db.execute(
          sql`SELECT actor_bot_id FROM audit_logs LIMIT 0`,
        );
        databaseHealthy = true;
      }
    } catch {}

    let redisHealthy = false;
    try {
      if (api.redis?.redis) {
        await api.redis.redis.ping();
        redisHealthy = true;
      }
    } catch {}

    const healthy = databaseHealthy && redisHealthy;

    return {
      name: api.process.name,
      pid: api.process.pid,
      version: packageJSON.version,
      uptime: new Date().getTime() - api.bootTime,
      consumedMemoryMB,
      healthy,
      checks: {
        database: databaseHealthy,
        redis: redisHealthy,
      },
    };
  }
}
