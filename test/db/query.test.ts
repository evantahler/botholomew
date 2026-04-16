import { describe, expect, test } from "bun:test";
import { buildSetClauses, buildWhereClause } from "../../src/db/query.ts";

describe("buildWhereClause", () => {
  test("builds clause from single filter", () => {
    const result = buildWhereClause([["name", "alice"]]);
    expect(result.where).toBe("WHERE name = ?1");
    expect(result.params).toEqual(["alice"]);
  });

  test("builds clause from multiple filters", () => {
    const result = buildWhereClause([
      ["status", "active"],
      ["priority", "high"],
    ]);
    expect(result.where).toBe("WHERE status = ?1 AND priority = ?2");
    expect(result.params).toEqual(["active", "high"]);
  });

  test("skips undefined values", () => {
    const result = buildWhereClause([
      ["status", "active"],
      ["priority", undefined],
      ["name", "bob"],
    ]);
    expect(result.where).toBe("WHERE status = ?1 AND name = ?2");
    expect(result.params).toEqual(["active", "bob"]);
  });

  test("returns empty string for empty filters", () => {
    const result = buildWhereClause([]);
    expect(result.where).toBe("");
    expect(result.params).toEqual([]);
  });

  test("returns empty string when all values are undefined", () => {
    const result = buildWhereClause([
      ["a", undefined],
      ["b", undefined],
    ]);
    expect(result.where).toBe("");
    expect(result.params).toEqual([]);
  });

  test("handles null values", () => {
    const result = buildWhereClause([["deleted_at", null]]);
    expect(result.where).toBe("WHERE deleted_at = ?1");
    expect(result.params).toEqual([null]);
  });

  test("handles numeric values", () => {
    const result = buildWhereClause([
      ["enabled", 1],
      ["max_retries", 5],
    ]);
    expect(result.where).toBe("WHERE enabled = ?1 AND max_retries = ?2");
    expect(result.params).toEqual([1, 5]);
  });
});

describe("buildSetClauses", () => {
  test("builds set clauses from single field", () => {
    const result = buildSetClauses([["name", "alice"]]);
    expect(result.setClauses).toEqual(["name = ?1"]);
    expect(result.params).toEqual(["alice"]);
  });

  test("builds set clauses from multiple fields", () => {
    const result = buildSetClauses([
      ["name", "alice"],
      ["status", "done"],
    ]);
    expect(result.setClauses).toEqual(["name = ?1", "status = ?2"]);
    expect(result.params).toEqual(["alice", "done"]);
  });

  test("skips undefined values", () => {
    const result = buildSetClauses([
      ["name", "alice"],
      ["description", undefined],
      ["status", "done"],
    ]);
    expect(result.setClauses).toEqual(["name = ?1", "status = ?2"]);
    expect(result.params).toEqual(["alice", "done"]);
  });

  test("returns empty arrays when all values are undefined", () => {
    const result = buildSetClauses([
      ["a", undefined],
      ["b", undefined],
    ]);
    expect(result.setClauses).toEqual([]);
    expect(result.params).toEqual([]);
  });

  test("returns empty arrays for empty input", () => {
    const result = buildSetClauses([]);
    expect(result.setClauses).toEqual([]);
    expect(result.params).toEqual([]);
  });

  test("parameter numbering is sequential across non-undefined values", () => {
    const result = buildSetClauses([
      ["a", undefined],
      ["b", "val1"],
      ["c", undefined],
      ["d", "val2"],
      ["e", "val3"],
    ]);
    expect(result.setClauses).toEqual(["b = ?1", "d = ?2", "e = ?3"]);
    expect(result.params).toEqual(["val1", "val2", "val3"]);
  });
});
