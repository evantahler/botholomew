import { describe, expect, test } from "bun:test";
import type { User } from "../../models/user";
import { checkPassword, hashPassword, serializeUser } from "../../ops/UserOps";

describe("hashPassword", () => {
  test("produces different hashes for different passwords", async () => {
    const hash1 = await hashPassword("password1");
    const hash2 = await hashPassword("password2");
    expect(hash1).not.toBe(hash2);
  });
});

describe("checkPassword", () => {
  test("returns true for correct password and false for incorrect password", async () => {
    const password = "correctHorseBatteryStaple";
    const password_hash = await hashPassword(password);
    const user: User = {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      password_hash,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(await checkPassword(user, password)).toBe(true);
    expect(await checkPassword(user, "wrongpassword")).toBe(false);
  });
});

describe("serializeUser", () => {
  test("returns the correct serialized user object", () => {
    const now = new Date();
    const user: User = {
      id: 2,
      name: "Alice",
      email: "alice@example.com",
      password_hash: "irrelevant",
      metadata: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = serializeUser(user);
    expect(result).toEqual({
      id: 2,
      name: "Alice",
      email: "alice@example.com",
      metadata: "",
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    });
  });
});
