import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILLS_DIR } from "../../src/constants.ts";
import { getSkill, loadSkills } from "../../src/skills/loader.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function makeSkillsDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
  const skillsDir = join(tempDir, SKILLS_DIR);
  await mkdir(skillsDir, { recursive: true });
  return skillsDir;
}

describe("loadSkills", () => {
  test("loads .md files from skills directory", async () => {
    const skillsDir = await makeSkillsDir();
    await Bun.write(
      join(skillsDir, "greet.md"),
      `---
name: greet
description: "Say hello"
arguments: []
---

Hello, world!`,
    );
    await Bun.write(
      join(skillsDir, "review.md"),
      `---
name: review
description: "Review code"
arguments:
  - name: file
    required: true
---

Review $1.`,
    );

    const skills = await loadSkills(tempDir);
    expect(skills.size).toBe(2);
    expect(skills.get("greet")?.description).toBe("Say hello");
    expect(skills.get("review")?.arguments).toHaveLength(1);
  });

  test("returns empty Map when skills directory does not exist", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    const skills = await loadSkills(tempDir);
    expect(skills.size).toBe(0);
  });

  test("returns empty Map when skills directory is empty", async () => {
    await makeSkillsDir();
    const skills = await loadSkills(tempDir);
    expect(skills.size).toBe(0);
  });

  test("ignores non-.md files", async () => {
    const skillsDir = await makeSkillsDir();
    await Bun.write(join(skillsDir, "notes.txt"), "not a skill");
    await Bun.write(
      join(skillsDir, "real.md"),
      `---
name: real
---

Content.`,
    );

    const skills = await loadSkills(tempDir);
    expect(skills.size).toBe(1);
    expect(skills.has("real")).toBe(true);
  });

  test("uses frontmatter name over filename", async () => {
    const skillsDir = await makeSkillsDir();
    await Bun.write(
      join(skillsDir, "file-name.md"),
      `---
name: custom-name
description: "Uses frontmatter name"
---

Body.`,
    );

    const skills = await loadSkills(tempDir);
    expect(skills.has("custom-name")).toBe(true);
    expect(skills.has("file-name")).toBe(false);
  });

  test("normalizes names to lowercase", async () => {
    const skillsDir = await makeSkillsDir();
    await Bun.write(
      join(skillsDir, "MySkill.md"),
      `---
name: MySkill
---

Body.`,
    );

    const skills = await loadSkills(tempDir);
    expect(skills.has("myskill")).toBe(true);
  });
});

describe("getSkill", () => {
  test("returns skill by name", async () => {
    const skillsDir = await makeSkillsDir();
    await Bun.write(
      join(skillsDir, "test.md"),
      `---
name: test
description: "A test skill"
---

Test body.`,
    );

    const skill = await getSkill(tempDir, "test");
    expect(skill).not.toBeNull();
    expect(skill?.description).toBe("A test skill");
  });

  test("returns null for unknown skill", async () => {
    await makeSkillsDir();
    const skill = await getSkill(tempDir, "nonexistent");
    expect(skill).toBeNull();
  });

  test("lookup is case-insensitive", async () => {
    const skillsDir = await makeSkillsDir();
    await Bun.write(
      join(skillsDir, "test.md"),
      `---
name: test
---

Body.`,
    );

    const skill = await getSkill(tempDir, "TEST");
    expect(skill).not.toBeNull();
  });
});
