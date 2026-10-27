import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSkillsDir } from "../constants.ts";
import { parseSkillFile, type SkillDefinition } from "./parser.ts";

export async function loadSkills(
  projectDir: string,
): Promise<Map<string, SkillDefinition>> {
  const skills = new Map<string, SkillDefinition>();
  const dir = getSkillsDir(projectDir);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return skills; // directory doesn't exist — graceful for pre-M7 projects
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    const raw = await Bun.file(filePath).text();
    const skill = parseSkillFile(raw, filePath);
    skills.set(skill.name, skill);
  }

  return skills;
}

export async function getSkill(
  projectDir: string,
  name: string,
): Promise<SkillDefinition | null> {
  const skills = await loadSkills(projectDir);
  return skills.get(name.toLowerCase()) ?? null;
}
