import { describe, expect, it } from "bun:test";
import { User } from "../../models/user";
import { checkPassword, hashPassword, serializeUser } from "../../ops/UserOps";

describe("UserOps", () => {
  describe("hashPassword", () => {
    it("should hash a password", async () => {
      const password = "testPassword123";
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it("should generate different hashes for same password", async () => {
      const password = "testPassword123";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("checkPassword", () => {
    it("should verify correct password", async () => {
      const password = "testPassword123";
      const hash = await hashPassword(password);

      const mockUser: User = {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        password_hash: hash,
        metadata: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const isValid = await checkPassword(mockUser, password);
      expect(isValid).toBe(true);
    });

    it("should reject incorrect password", async () => {
      const password = "testPassword123";
      const hash = await hashPassword(password);

      const mockUser: User = {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        password_hash: hash,
        metadata: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const isValid = await checkPassword(mockUser, "wrongPassword");
      expect(isValid).toBe(false);
    });
  });

  describe("serializeUser", () => {
    it("should serialize user correctly", () => {
      const now = new Date();
      const mockUser: User = {
        id: 123,
        name: "Test User",
        email: "test@example.com",
        password_hash: "hashedPassword",
        metadata: "user metadata",
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeUser(mockUser);

      expect(serialized).toEqual({
        id: 123,
        name: "Test User",
        email: "test@example.com",
        metadata: "user metadata",
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
    });

    it("should handle null metadata", () => {
      const now = new Date();
      const mockUser: User = {
        id: 456,
        name: "Another User",
        email: "another@example.com",
        password_hash: "hashedPassword",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeUser(mockUser);

      expect(serialized.metadata).toBe("");
    });

    it("should not include password_hash in serialized output", () => {
      const mockUser: User = {
        id: 789,
        name: "Secure User",
        email: "secure@example.com",
        password_hash: "hashedPassword",
        metadata: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeUser(mockUser);

      expect(serialized).not.toHaveProperty("password_hash");
    });
  });
});
