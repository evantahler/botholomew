import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { api, config, type ActionResponse } from "../../api";
import type { Status } from "../../actions/status";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
});

afterAll(async () => {
  await api.stop();
});

describe("booting", () => {
  test("the web server will boot on a test port", async () => {
    expect(url).toContain(":80"); // the port will be dynamic
  });
});

describe("actions", () => {
  test("the web server can handle a request to an action", async () => {
    const res = await fetch(url + "/api/status");
    expect(res.status).toBe(200);
    const response = (await res.json()) as ActionResponse<Status>;
    expect(response.name).toInclude("test-server");
  });

  test("trying for a non-existent action returns a 404", async () => {
    const res = await fetch(url + "/api/non-existent-action");
    expect(res.status).toBe(404);
    const response = (await res.json()) as ActionResponse<Status>;
    expect(response.error?.message).toContain("Action not found");
    expect(response.error?.stack).toContain("/botholomew/");
  });
});

describe("static files", () => {
  test("the web server can serve static files from the frontend directory", async () => {
    const res = await fetch(url + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<html");
  });

  test("the web server serves index.html for root requests", async () => {
    const res = await fetch(url + "/index.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("the web server can serve other static files", async () => {
    const res = await fetch(url + "/test-ws.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<html");
  });

  test("non-existent static files return 404", async () => {
    const res = await fetch(url + "/non-existent-file.html");
    expect(res.status).toBe(404);
  });
});
