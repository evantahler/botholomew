import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HOME_CONFIG_DIR, sanitizePathForServiceName } from "../constants.ts";

const REGISTRY_PATH = join(HOME_CONFIG_DIR, "projects.json");

interface ProjectEntry {
  projectDir: string;
  installedAt: string;
}

type ProjectRegistry = Record<string, ProjectEntry>;

export async function readRegistry(): Promise<ProjectRegistry> {
  const file = Bun.file(REGISTRY_PATH);
  if (!(await file.exists())) return {};
  try {
    return (await file.json()) as ProjectRegistry;
  } catch {
    return {};
  }
}

async function writeRegistry(registry: ProjectRegistry): Promise<void> {
  await mkdir(HOME_CONFIG_DIR, { recursive: true });
  await Bun.write(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

export async function registerProject(projectDir: string): Promise<void> {
  const registry = await readRegistry();
  const key = sanitizePathForServiceName(projectDir);
  registry[key] = { projectDir, installedAt: new Date().toISOString() };
  await writeRegistry(registry);
}

export async function unregisterProject(projectDir: string): Promise<void> {
  const registry = await readRegistry();
  const key = sanitizePathForServiceName(projectDir);
  delete registry[key];
  await writeRegistry(registry);
}

export async function listRegisteredProjects(): Promise<
  Array<{ projectDir: string; installedAt: string }>
> {
  const registry = await readRegistry();
  return Object.values(registry);
}
