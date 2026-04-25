import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSkillsDir } from "../../src/constants.ts";
import { loadSkills } from "../../src/skills/loader.ts";
import { skillDeleteTool } from "../../src/tools/skill/delete.ts";
import { skillEditTool } from "../../src/tools/skill/edit.ts";
import { skillListTool } from "../../src/tools/skill/list.ts";
import { skillReadTool } from "../../src/tools/skill/read.ts";
import { skillSearchTool } from "../../src/tools/skill/search.ts";
import { skillWriteTool } from "../../src/tools/skill/write.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { setupToolContext } from "../helpers.ts";

let tempDir: string;
let ctx: ToolContext;

async function seedSkill(
  projectDir: string,
  filename: string,
  content: string,
): Promise<void> {
  const dir = getSkillsDir(projectDir);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, filename), content);
}

beforeEach(async () => {
  ({ ctx } = await setupToolContext());
  tempDir = await mkdtemp(join(tmpdir(), "both-skill-tool-"));
  await mkdir(getSkillsDir(tempDir), { recursive: true });
  ctx.projectDir = tempDir;
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ── skill_list ─────────────────────────────────────────────────

describe("skill_list", () => {
  test("returns empty when no skills exist", async () => {
    const result = await skillListTool.execute({ limit: 100, offset: 0 }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.skills).toEqual([]);
    expect(result.total).toBe(0);
  });

  test("lists skills sorted by name", async () => {
    await seedSkill(
      tempDir,
      "zeta.md",
      "---\nname: zeta\ndescription: z\narguments: []\n---\nbody-z\n",
    );
    await seedSkill(
      tempDir,
      "alpha.md",
      "---\nname: alpha\ndescription: a\narguments: []\n---\nbody-a\n",
    );
    await seedSkill(
      tempDir,
      "mid.md",
      "---\nname: mid\ndescription: m\narguments:\n  - name: x\n    description: an x\n    required: true\n---\nbody-m\n",
    );

    const result = await skillListTool.execute({ limit: 100, offset: 0 }, ctx);
    expect(result.total).toBe(3);
    expect(result.skills.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
    expect(result.skills[1]?.arguments).toEqual(["x"]);
    expect(result.skills[1]?.filename).toBe("mid.md");
  });

  test("respects limit and offset", async () => {
    for (const n of ["a", "b", "c", "d"]) {
      await seedSkill(
        tempDir,
        `${n}.md`,
        `---\nname: ${n}\ndescription: ${n}\narguments: []\n---\nbody-${n}\n`,
      );
    }

    const result = await skillListTool.execute({ limit: 2, offset: 1 }, ctx);
    expect(result.total).toBe(4);
    expect(result.skills.map((s) => s.name)).toEqual(["b", "c"]);
  });
});

// ── skill_read ─────────────────────────────────────────────────

describe("skill_read", () => {
  test("returns parsed fields and raw content", async () => {
    const raw =
      "---\nname: review\ndescription: Review code\narguments:\n  - name: file\n    description: file path\n    required: true\n---\nReview $1 thoroughly.\n";
    await seedSkill(tempDir, "review.md", raw);

    const result = await skillReadTool.execute({ name: "review" }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.name).toBe("review");
    expect(result.description).toBe("Review code");
    expect(result.body).toBe("Review $1 thoroughly.");
    expect(result.arguments[0]?.name).toBe("file");
    expect(result.raw).toBe(raw);
  });

  test("is case-insensitive", async () => {
    await seedSkill(
      tempDir,
      "lower.md",
      "---\nname: lower\ndescription: l\narguments: []\n---\nbody\n",
    );

    const result = await skillReadTool.execute({ name: "LOWER" }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.name).toBe("lower");
  });

  test("returns not_found with available names hint", async () => {
    await seedSkill(
      tempDir,
      "alpha.md",
      "---\nname: alpha\ndescription: a\narguments: []\n---\nbody\n",
    );
    await seedSkill(
      tempDir,
      "beta.md",
      "---\nname: beta\ndescription: b\narguments: []\n---\nbody\n",
    );

    const result = await skillReadTool.execute({ name: "missing" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.next_action_hint).toContain("alpha");
    expect(result.next_action_hint).toContain("beta");
  });

  test("returns not_found with create-hint when no skills exist", async () => {
    const result = await skillReadTool.execute({ name: "anything" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.next_action_hint).toContain("skill_write");
  });
});

// ── skill_write ────────────────────────────────────────────────

describe("skill_write", () => {
  test("creates a new skill", async () => {
    const result = await skillWriteTool.execute(
      {
        name: "summarize",
        description: "Summarize stuff",
        body: "Summarize $ARGUMENTS in three bullets.",
        on_conflict: "error",
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.created).toBe(true);
    expect(result.name).toBe("summarize");
    expect(result.path).toBe(join(getSkillsDir(tempDir), "summarize.md"));
    expect(result.ref).toBe("skill:summarize");

    const skills = await loadSkills(tempDir);
    const s = skills.get("summarize");
    expect(s?.description).toBe("Summarize stuff");
    expect(s?.body).toBe("Summarize $ARGUMENTS in three bullets.");
  });

  test("normalizes name and aligns frontmatter with filename (anti-drift)", async () => {
    const result = await skillWriteTool.execute(
      {
        name: "My Skill!",
        description: "d",
        body: "b",
        on_conflict: "error",
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.name).toBe("my-skill");
    expect(result.path).toBe(join(getSkillsDir(tempDir), "my-skill.md"));

    const skills = await loadSkills(tempDir);
    expect(skills.get("my-skill")?.name).toBe("my-skill");
  });

  test("rejects reserved names", async () => {
    for (const reserved of ["help", "skills", "clear", "exit"]) {
      const result = await skillWriteTool.execute(
        {
          name: reserved,
          description: "d",
          body: "b",
          on_conflict: "error",
        },
        ctx,
      );
      expect(result.is_error).toBe(true);
      expect(result.error_type).toBe("reserved_name");
    }
  });

  test("rejects names that normalize to empty", async () => {
    const result = await skillWriteTool.execute(
      { name: "!!!", description: "d", body: "b", on_conflict: "error" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_name");
  });

  test("rejects empty body", async () => {
    const result = await skillWriteTool.execute(
      {
        name: "noop",
        description: "d",
        body: "   \n  ",
        on_conflict: "error",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("empty_body");
  });

  test("returns path_conflict when file exists by default", async () => {
    await seedSkill(
      tempDir,
      "dup.md",
      "---\nname: dup\ndescription: existing\narguments: []\n---\noriginal\n",
    );

    const result = await skillWriteTool.execute(
      {
        name: "dup",
        description: "new",
        body: "new body",
        on_conflict: "error",
      },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("path_conflict");
    const skills = await loadSkills(tempDir);
    expect(skills.get("dup")?.body).toBe("original");
  });

  test("overwrites with on_conflict='overwrite' and reports created=false", async () => {
    await seedSkill(
      tempDir,
      "dup.md",
      "---\nname: dup\ndescription: existing\narguments: []\n---\noriginal\n",
    );

    const result = await skillWriteTool.execute(
      {
        name: "dup",
        description: "updated",
        body: "new body",
        on_conflict: "overwrite",
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.created).toBe(false);
    const skills = await loadSkills(tempDir);
    expect(skills.get("dup")?.description).toBe("updated");
    expect(skills.get("dup")?.body).toBe("new body");
  });

  test("round-trips arguments shape", async () => {
    const result = await skillWriteTool.execute(
      {
        name: "review",
        description: "review",
        body: "Review $1 with focus $2.",
        arguments: [
          { name: "file", description: "file path", required: true },
          {
            name: "focus",
            description: "focus area",
            required: false,
            default: "general",
          },
        ],
        on_conflict: "error",
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    const skills = await loadSkills(tempDir);
    const s = skills.get("review");
    expect(s?.arguments).toEqual([
      { name: "file", description: "file path", required: true },
      {
        name: "focus",
        description: "focus area",
        required: false,
        default: "general",
      },
    ]);
  });

  test("handles description with newlines and quotes (YAML-safe)", async () => {
    const result = await skillWriteTool.execute(
      {
        name: "tricky",
        description: 'has "quotes": and a colon',
        body: "body",
        on_conflict: "error",
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    const skills = await loadSkills(tempDir);
    expect(skills.get("tricky")?.description).toBe('has "quotes": and a colon');
  });
});

// ── skill_edit ─────────────────────────────────────────────────

describe("skill_edit", () => {
  test("applies a body replacement", async () => {
    await seedSkill(
      tempDir,
      "doc.md",
      "---\nname: doc\ndescription: d\narguments: []\n---\noriginal body\n",
    );

    const original = await Bun.file(
      join(getSkillsDir(tempDir), "doc.md"),
    ).text();
    const lines = original.split("\n");
    const bodyLineIdx = lines.indexOf("original body") + 1;

    const result = await skillEditTool.execute(
      {
        name: "doc",
        patches: [
          {
            start_line: bodyLineIdx,
            end_line: bodyLineIdx,
            content: "updated body",
          },
        ],
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.applied).toBe(1);
    const skills = await loadSkills(tempDir);
    expect(skills.get("doc")?.body).toBe("updated body");
  });

  test("rejects edit that breaks frontmatter and leaves file unchanged", async () => {
    const raw =
      "---\nname: doc\ndescription: d\narguments: []\n---\noriginal body\n";
    await seedSkill(tempDir, "doc.md", raw);

    // Replace the description line with malformed YAML (unterminated string).
    const result = await skillEditTool.execute(
      {
        name: "doc",
        patches: [
          {
            start_line: 3,
            end_line: 3,
            content: 'description: "unterminated',
          },
        ],
      },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_skill");
    const onDisk = await Bun.file(join(getSkillsDir(tempDir), "doc.md")).text();
    expect(onDisk).toBe(raw);
  });

  test("rejects edit that changes frontmatter name to mismatch filename", async () => {
    await seedSkill(
      tempDir,
      "doc.md",
      "---\nname: doc\ndescription: d\narguments: []\n---\nbody\n",
    );

    const result = await skillEditTool.execute(
      {
        name: "doc",
        patches: [{ start_line: 2, end_line: 2, content: "name: other" }],
      },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_skill");
  });

  test("returns not_found for missing skill", async () => {
    const result = await skillEditTool.execute(
      {
        name: "ghost",
        patches: [{ start_line: 1, end_line: 1, content: "x" }],
      },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
  });

  test("applies multiple patches in reverse order without line-shift bugs", async () => {
    await seedSkill(
      tempDir,
      "multi.md",
      "---\nname: multi\ndescription: d\narguments: []\n---\nA\nB\nC\nD\n",
    );

    const path = join(getSkillsDir(tempDir), "multi.md");
    const raw = await Bun.file(path).text();
    const lines = raw.split("\n");
    const aIdx = lines.indexOf("A") + 1;
    const cIdx = lines.indexOf("C") + 1;

    const result = await skillEditTool.execute(
      {
        name: "multi",
        patches: [
          { start_line: aIdx, end_line: aIdx, content: "A1" },
          { start_line: cIdx, end_line: cIdx, content: "C1" },
        ],
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    const skills = await loadSkills(tempDir);
    expect(skills.get("multi")?.body).toBe("A1\nB\nC1\nD");
  });
});

// ── skill_search ───────────────────────────────────────────────

describe("skill_search", () => {
  beforeEach(async () => {
    await seedSkill(
      tempDir,
      "standup.md",
      "---\nname: standup\ndescription: daily team standup update\narguments: []\n---\nGenerate a standup summary from completed tasks today.\n",
    );
    await seedSkill(
      tempDir,
      "review.md",
      "---\nname: review\ndescription: review code for issues\narguments:\n  - name: file\n    description: path to inspect\n    required: true\n---\nRead the file and report bugs and concerns.\n",
    );
    await seedSkill(
      tempDir,
      "summarize.md",
      "---\nname: summarize\ndescription: summarize a chat thread\narguments: []\n---\nProduce a concise summary of the conversation.\n",
    );
  });

  test("ranks name matches highest", async () => {
    const result = await skillSearchTool.execute(
      { query: "standup", top_k: 10 },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.results[0]?.name).toBe("standup");
    expect(result.results[0]?.match_fields).toContain("name");
  });

  test("matches body content with lower score", async () => {
    const result = await skillSearchTool.execute(
      { query: "bugs", top_k: 10 },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.name).toBe("review");
    expect(result.results[0]?.match_fields).toContain("body");
  });

  test("matches argument metadata", async () => {
    const result = await skillSearchTool.execute(
      { query: "inspect", top_k: 10 },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.results[0]?.name).toBe("review");
    expect(result.results[0]?.match_fields).toContain("argument_description");
  });

  test("respects top_k", async () => {
    const result = await skillSearchTool.execute(
      { query: "summary", top_k: 1 },
      ctx,
    );
    expect(result.results.length).toBe(1);
  });

  test("returns empty results with hint when no matches", async () => {
    const result = await skillSearchTool.execute(
      { query: "kubernetes", top_k: 10 },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.hint).toContain("No matches");
  });

  test("hints when no skills exist at all", async () => {
    await rm(getSkillsDir(tempDir), { recursive: true, force: true });
    await mkdir(getSkillsDir(tempDir), { recursive: true });

    const result = await skillSearchTool.execute(
      { query: "anything", top_k: 10 },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.hint).toContain("No skills exist yet");
  });
});

// ── skill_delete ───────────────────────────────────────────────

describe("skill_delete", () => {
  test("deletes an existing skill", async () => {
    await seedSkill(
      tempDir,
      "doomed.md",
      "---\nname: doomed\ndescription: bye\narguments: []\n---\nbody\n",
    );

    const result = await skillDeleteTool.execute({ name: "doomed" }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.deleted).toBe(true);
    expect(result.name).toBe("doomed");
    expect(result.path).toContain("doomed.md");

    const skills = await loadSkills(tempDir);
    expect(skills.has("doomed")).toBe(false);
    expect(
      await Bun.file(join(getSkillsDir(tempDir), "doomed.md")).exists(),
    ).toBe(false);
  });

  test("looks up name case-insensitively", async () => {
    await seedSkill(
      tempDir,
      "review.md",
      "---\nname: review\ndescription: r\narguments: []\n---\nbody\n",
    );

    const result = await skillDeleteTool.execute({ name: "REVIEW" }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.deleted).toBe(true);

    const skills = await loadSkills(tempDir);
    expect(skills.has("review")).toBe(false);
  });

  test("returns not_found with hint when no skills exist", async () => {
    const result = await skillDeleteTool.execute({ name: "nope" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.deleted).toBe(false);
    expect(result.next_action_hint).toContain("skill_write");
  });

  test("returns not_found listing available names when other skills exist", async () => {
    await seedSkill(
      tempDir,
      "alpha.md",
      "---\nname: alpha\ndescription: a\narguments: []\n---\nbody\n",
    );
    await seedSkill(
      tempDir,
      "beta.md",
      "---\nname: beta\ndescription: b\narguments: []\n---\nbody\n",
    );

    const result = await skillDeleteTool.execute({ name: "missing" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.next_action_hint).toContain("alpha");
    expect(result.next_action_hint).toContain("beta");

    const skills = await loadSkills(tempDir);
    expect(skills.has("alpha")).toBe(true);
    expect(skills.has("beta")).toBe(true);
  });
});
