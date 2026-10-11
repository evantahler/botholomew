import { describe, expect, test } from "bun:test";
import { readSessionCookie, setCookieHeaders } from "../src/client.ts";

describe("setCookieHeaders", () => {
  test("uses getSetCookie when it exists", () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "__session=from-getsetcookie; Path=/; HttpOnly",
    );
    if (typeof headers.getSetCookie !== "function") return;
    expect(readSessionCookie(setCookieHeaders(headers))).toBe(
      "from-getsetcookie",
    );
  });

  test("falls back to get('set-cookie') when getSetCookie is missing", () => {
    const headers = {
      get(name: string) {
        if (name.toLowerCase() === "set-cookie") {
          return "__session=legacy; Path=/";
        }
        return null;
      },
    } as Headers;
    expect(readSessionCookie(setCookieHeaders(headers))).toBe("legacy");
  });
});

describe("readSessionCookie", () => {
  test("ignores other cookies", () => {
    expect(readSessionCookie(["other=1", "__session=keep-me; Path=/"])).toBe(
      "keep-me",
    );
  });
});
