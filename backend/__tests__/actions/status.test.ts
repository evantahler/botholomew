import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Status } from "../../actions/status";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
});

afterAll(async () => {
  await api.stop();
});

describe("status", () => {
  test("the web server can handle a request to an action", async () => {
    const res = await fetch(url + "/api/status");
    expect(res.status).toBe(200);
    const response = (await res.json()) as ActionResponse<Status>;

    expect(response.name).toInclude("test-server");
    expect(response.uptime).toBeGreaterThan(0);
    expect(response.consumedMemoryMB).toBeGreaterThan(0);
  });
});
