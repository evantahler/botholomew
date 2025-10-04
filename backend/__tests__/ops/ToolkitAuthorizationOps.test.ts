import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { api } from "../../api";
import { toolkit_authorizations } from "../../models/toolkit_authorization";
import {
  getUnauthorizedToolkits,
  isUserAuthorizedForToolkits,
  serializeToolkitAuthorization,
} from "../../ops/ToolkitAuthorizationOps";
import { createUserAndSession, USERS } from "../utils/testHelpers";

describe("ToolkitAuthorizationOps", () => {
  let userId: number;

  beforeAll(async () => {
    await api.start();
    await api.db.clearDatabase();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    await api.db.clearDatabase();
    const testSession = await createUserAndSession(USERS.MARIO);
    userId = testSession.user.id;
  });

  describe("serializeToolkitAuthorization", () => {
    it("should serialize toolkit authorization correctly", async () => {
      const [tka] = await api.db.db
        .insert(toolkit_authorizations)
        .values({
          userId,
          toolkitName: "web_search",
        })
        .returning();

      const serialized = serializeToolkitAuthorization(tka);

      expect(serialized).toEqual({
        id: tka.id,
        toolkitName: "web_search",
        userId,
        createdAt: tka.createdAt.getTime(),
        updatedAt: tka.updatedAt.getTime(),
      });
    });
  });

  describe("isUserAuthorizedForToolkits", () => {
    it("should return true when user has all required toolkits", async () => {
      await api.db.db.insert(toolkit_authorizations).values([
        { userId, toolkitName: "web_search" },
        { userId, toolkitName: "file_operations" },
      ]);

      const isAuthorized = await isUserAuthorizedForToolkits(userId, [
        "web_search",
        "file_operations",
      ]);

      expect(isAuthorized).toBe(true);
    });

    it("should return false when user is missing a toolkit", async () => {
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId, toolkitName: "web_search" }]);

      const isAuthorized = await isUserAuthorizedForToolkits(userId, [
        "web_search",
        "file_operations",
      ]);

      expect(isAuthorized).toBe(false);
    });

    it("should return true for empty toolkit list", async () => {
      const isAuthorized = await isUserAuthorizedForToolkits(userId, []);
      expect(isAuthorized).toBe(true);
    });

    it("should return false when user has no authorizations", async () => {
      const isAuthorized = await isUserAuthorizedForToolkits(userId, [
        "web_search",
      ]);

      expect(isAuthorized).toBe(false);
    });

    it("should return true when user has more toolkits than required", async () => {
      await api.db.db.insert(toolkit_authorizations).values([
        { userId, toolkitName: "web_search" },
        { userId, toolkitName: "file_operations" },
        { userId, toolkitName: "database" },
      ]);

      const isAuthorized = await isUserAuthorizedForToolkits(userId, [
        "web_search",
      ]);

      expect(isAuthorized).toBe(true);
    });
  });

  describe("getUnauthorizedToolkits", () => {
    it("should return empty array when user has all toolkits", async () => {
      await api.db.db.insert(toolkit_authorizations).values([
        { userId, toolkitName: "web_search" },
        { userId, toolkitName: "file_operations" },
      ]);

      const unauthorized = await getUnauthorizedToolkits(userId, [
        "web_search",
        "file_operations",
      ]);

      expect(unauthorized).toEqual([]);
    });

    it("should return missing toolkits", async () => {
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId, toolkitName: "web_search" }]);

      const unauthorized = await getUnauthorizedToolkits(userId, [
        "web_search",
        "file_operations",
        "database",
      ]);

      expect(unauthorized).toEqual(["file_operations", "database"]);
    });

    it("should return empty array for empty toolkit list", async () => {
      const unauthorized = await getUnauthorizedToolkits(userId, []);
      expect(unauthorized).toEqual([]);
    });

    it("should return all toolkits when user has no authorizations", async () => {
      const unauthorized = await getUnauthorizedToolkits(userId, [
        "web_search",
        "file_operations",
      ]);

      expect(unauthorized).toEqual(["web_search", "file_operations"]);
    });

    it("should handle single toolkit check", async () => {
      await api.db.db
        .insert(toolkit_authorizations)
        .values([{ userId, toolkitName: "web_search" }]);

      const unauthorized = await getUnauthorizedToolkits(userId, [
        "file_operations",
      ]);

      expect(unauthorized).toEqual(["file_operations"]);
    });
  });
});
