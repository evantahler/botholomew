import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ActionResponse, api } from "keryx";
import { Status } from "../../actions/status";
import { HOOK_TIMEOUT, serverUrl } from "../setup";

let url: string;

beforeAll(async () => {
  await api.start();
  url = serverUrl();
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("status", () => {
  test("opts out of Sentry tracing", () => {
    // `@keryxjs/sentry` reads `tracing === false` off the live action. This
    // class replaces Keryx's built-in `status`, which already opts out, so
    // the flag has to be restated here or load-balancer probes fill Sentry
    // the moment traces are turned on.
    const action = api.actions.actions.find((a) => a.name === "status");
    expect(action).toBeInstanceOf(Status);
    expect(action?.tracing).toBe(false);
  });

  test("boots a real server on a random free port", () => {
    // Loopback rather than `localhost`: tests bind `0.0.0.0`, as deployed
    // services do, and `serverUrl()` rewrites the wildcard to an address that
    // means something to `fetch`. See the note in `.env.example`.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(new URL(url).port).not.toBe("0");
  });

  test("reports healthy dependencies over HTTP", async () => {
    const res = await fetch(`${url}/api/status`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ActionResponse<Status>;
    expect(body.checks.database).toBe(true);
    expect(body.checks.redis).toBe(true);
    expect(body.healthy).toBe(true);
    expect(body.name).toBe("botholomew-test");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});
