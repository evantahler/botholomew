import { describe, expect, test } from "bun:test";
import type { Notification } from "../../src/notify/dispatch.ts";
import { renderArgs, renderTemplate } from "../../src/notify/template.ts";

const n: Notification = {
  title: "Task done",
  message: "The report is ready",
  severity: "warning",
};

describe("renderTemplate", () => {
  test("substitutes all placeholders in a flat string", () => {
    expect(renderTemplate("{{title}}: {{message}} [{{severity}}]", n)).toBe(
      "Task done: The report is ready [warning]",
    );
  });

  test("defaults severity to info when omitted", () => {
    expect(renderTemplate("{{severity}}", { title: "t", message: "m" })).toBe(
      "info",
    );
  });

  test("recurses into nested arrays and objects", () => {
    const args = {
      channel: "#alerts",
      blocks: [{ text: "{{title}}" }, { text: "{{message}}" }],
      meta: { level: "{{severity}}", static: 42 },
    };
    expect(renderArgs(args, n)).toEqual({
      channel: "#alerts",
      blocks: [{ text: "Task done" }, { text: "The report is ready" }],
      meta: { level: "warning", static: 42 },
    });
  });

  test("leaves non-string leaves and placeholder-free strings untouched", () => {
    const args = { count: 3, flag: true, note: "no placeholders here" };
    expect(renderArgs(args, n)).toEqual(args);
  });
});
