import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  getWatchdogLogPath,
  LAUNCHD_LABEL_PREFIX,
  SYSTEMD_UNIT_PREFIX,
  sanitizePathForServiceName,
} from "../constants.ts";
import {
  listRegisteredProjects,
  registerProject,
  unregisterProject,
} from "../utils/project-registry.ts";

export type Platform = "macos" | "linux";

export function detectPlatform(): Platform {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function getServiceName(projectDir: string): string {
  return sanitizePathForServiceName(resolve(projectDir));
}

function getHealthcheckCommand(projectDir: string): string[] {
  const healthcheckScript = new URL("./healthcheck.ts", import.meta.url)
    .pathname;
  return ["bun", "run", healthcheckScript, resolve(projectDir)];
}

function getLaunchdLabel(projectDir: string): string {
  return `${LAUNCHD_LABEL_PREFIX}${getServiceName(projectDir)}`;
}

function getLaunchdPlistPath(projectDir: string): string {
  return join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${getLaunchdLabel(projectDir)}.plist`,
  );
}

function getSystemdBaseName(projectDir: string): string {
  return `${SYSTEMD_UNIT_PREFIX}${getServiceName(projectDir)}`;
}

function getSystemdDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

export function generateLaunchdPlist(
  projectDir: string,
  healthcheckCmd: string[],
): string {
  const absDir = resolve(projectDir);
  const label = getLaunchdLabel(absDir);
  const watchdogLog = getWatchdogLogPath(absDir);

  const programArgs = healthcheckCmd
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(watchdogLog)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(watchdogLog)}</string>
</dict>
</plist>
`;
}

export function generateSystemdService(
  projectDir: string,
  healthcheckCmd: string[],
): string {
  const absDir = resolve(projectDir);
  return `[Unit]
Description=Botholomew healthcheck for ${absDir}

[Service]
Type=oneshot
ExecStart=${healthcheckCmd.join(" ")}

[Install]
WantedBy=default.target
`;
}

export function generateSystemdTimer(serviceName: string): string {
  return `[Unit]
Description=Botholomew watchdog timer for ${serviceName}

[Timer]
OnBootSec=60
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
`;
}

export function generateWatchdogConfig(projectDir: string): {
  platform: Platform;
  files: Array<{ path: string; content: string }>;
} {
  const absDir = resolve(projectDir);
  const platform = detectPlatform();
  const cmd = getHealthcheckCommand(absDir);

  if (platform === "macos") {
    return {
      platform,
      files: [
        {
          path: getLaunchdPlistPath(absDir),
          content: generateLaunchdPlist(absDir, cmd),
        },
      ],
    };
  }

  const baseName = getSystemdBaseName(absDir);
  const systemdDir = getSystemdDir();
  return {
    platform,
    files: [
      {
        path: join(systemdDir, `${baseName}.service`),
        content: generateSystemdService(absDir, cmd),
      },
      {
        path: join(systemdDir, `${baseName}.timer`),
        content: generateSystemdTimer(baseName),
      },
    ],
  };
}

export async function installWatchdog(projectDir: string): Promise<{
  installed: boolean;
  platform: Platform;
  paths: string[];
}> {
  const absDir = resolve(projectDir);
  const config = generateWatchdogConfig(absDir);
  const paths: string[] = [];

  for (const file of config.files) {
    await Bun.write(file.path, file.content);
    paths.push(file.path);
  }

  if (config.platform === "macos") {
    const plistPath = config.files[0]?.path;
    if (!plistPath) throw new Error("No plist file generated");
    const proc = Bun.spawnSync(["launchctl", "load", plistPath]);
    if (proc.exitCode !== 0) {
      const stderr = proc.stderr.toString().trim();
      throw new Error(`launchctl load failed: ${stderr}`);
    }
  } else {
    const baseName = getSystemdBaseName(absDir);
    const reload = Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
    if (reload.exitCode !== 0) {
      throw new Error(
        `systemctl daemon-reload failed: ${reload.stderr.toString().trim()}`,
      );
    }
    const enable = Bun.spawnSync([
      "systemctl",
      "--user",
      "enable",
      "--now",
      `${baseName}.timer`,
    ]);
    if (enable.exitCode !== 0) {
      throw new Error(
        `systemctl enable failed: ${enable.stderr.toString().trim()}`,
      );
    }
  }

  await registerProject(absDir);

  return { installed: true, platform: config.platform, paths };
}

export async function uninstallWatchdog(projectDir: string): Promise<{
  removed: boolean;
  platform: Platform;
}> {
  const absDir = resolve(projectDir);
  const platform = detectPlatform();

  if (platform === "macos") {
    const plistPath = getLaunchdPlistPath(absDir);
    const file = Bun.file(plistPath);
    if (!(await file.exists())) {
      return { removed: false, platform };
    }
    Bun.spawnSync(["launchctl", "unload", plistPath]);
    try {
      await unlink(plistPath);
    } catch {
      // ignore
    }
  } else {
    const baseName = getSystemdBaseName(absDir);
    Bun.spawnSync([
      "systemctl",
      "--user",
      "disable",
      "--now",
      `${baseName}.timer`,
    ]);
    const systemdDir = getSystemdDir();
    for (const ext of [".service", ".timer"]) {
      try {
        await unlink(join(systemdDir, `${baseName}${ext}`));
      } catch {
        // ignore
      }
    }
    Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
  }

  await unregisterProject(absDir);

  return { removed: true, platform };
}

export async function getWatchdogStatus(projectDir: string): Promise<{
  installed: boolean;
  platform: Platform;
  configPath?: string;
}> {
  const absDir = resolve(projectDir);
  const platform = detectPlatform();

  if (platform === "macos") {
    const plistPath = getLaunchdPlistPath(absDir);
    const exists = await Bun.file(plistPath).exists();
    return {
      installed: exists,
      platform,
      configPath: exists ? plistPath : undefined,
    };
  }

  const baseName = getSystemdBaseName(absDir);
  const timerPath = join(getSystemdDir(), `${baseName}.timer`);
  const exists = await Bun.file(timerPath).exists();
  return {
    installed: exists,
    platform,
    configPath: exists ? timerPath : undefined,
  };
}

export async function listAllWatchdogProjects(): Promise<
  Array<{ projectDir: string; configPath: string }>
> {
  const projects = await listRegisteredProjects();
  const platform = detectPlatform();
  const results: Array<{ projectDir: string; configPath: string }> = [];

  for (const project of projects) {
    let configPath: string;
    if (platform === "macos") {
      configPath = getLaunchdPlistPath(project.projectDir);
    } else {
      const baseName = getSystemdBaseName(project.projectDir);
      configPath = join(getSystemdDir(), `${baseName}.timer`);
    }
    results.push({ projectDir: project.projectDir, configPath });
  }

  return results;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
