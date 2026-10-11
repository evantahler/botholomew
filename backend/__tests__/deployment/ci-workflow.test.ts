import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `ci.yml` has one required status check — `complete` — and the whole
 * arrangement rests on two properties no other test would notice drifting:
 * the gate `needs` every other job, and it asserts each result **is**
 * `success` rather than listing outcomes that are not. A job left out of
 * `needs` runs, can fail, and blocks nothing.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** The subset of a GitHub Actions job this suite reads. */
interface Job {
  name?: string;
  needs?: string[];
  if?: string;
  services?: Record<string, { image?: string; env?: Record<string, string> }>;
  steps?: { run?: string; env?: Record<string, string> }[];
}

const workflow = Bun.YAML.parse(
  readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8"),
) as { jobs: Record<string, Job> };

const gate = workflow.jobs.complete;

describe("ci.yml — the one required check", () => {
  test("the gate reports as `complete` and runs whatever happened upstream", () => {
    // `complete` is the context `main`'s branch protection requires. A job's
    // check run carries its `name`, so a different name here is a required
    // check that never reports, and every pull request waits on it forever.
    expect(gate?.name).toBe("complete");
    // Without `always()`, a failed dependency skips the gate, and a skipped
    // required check is not a red one.
    expect(gate?.if).toBe("always()");
  });

  test("the gate needs every other job", () => {
    const others = Object.keys(workflow.jobs)
      .filter((id) => id !== "complete")
      .sort();
    expect(others.length).toBeGreaterThan(5);
    expect([...(gate?.needs ?? [])].sort()).toEqual(others);
  });

  test("the gate asserts success rather than listing failures", () => {
    const script = (gate?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(script).toContain('.result != "success"');
    // A denylist of outcomes is the shape that fails open.
    expect(script).not.toMatch(/failure\|cancelled|cancelled\|skipped/);
    // `needs` reaches the shell through env, never interpolated into it.
    expect(gate?.steps?.[0]?.env?.NEEDS).toBe("${{ toJSON(needs) }}");
    expect(script).not.toContain("${{");
  });

  test("every Postgres service container is the pgvector image on 18", () => {
    const postgres = Object.values(workflow.jobs).flatMap((job) =>
      Object.entries(job.services ?? {}).filter(
        ([name]) => name === "postgres",
      ),
    );
    expect(postgres.length).toBeGreaterThan(0);
    for (const [, svc] of postgres) {
      expect(svc.image).toBe("pgvector/pgvector:pg18");
      expect(svc.env?.POSTGRES_DB).toBe("botholomew_test");
    }
  });
});
