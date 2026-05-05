import { homedir, platform } from "node:os";
import { resolve, sep } from "node:path";

export type IncompatibleSync =
  | "icloud"
  | "dropbox"
  | "google-drive"
  | "onedrive";

export interface FilesystemCompatIssue {
  kind: IncompatibleSync;
  detail: string;
}

/**
 * Detect whether `projectDir` lives inside a sync-overlay filesystem where
 * `rename` and `O_EXCL` semantics aren't reliable. These overlays can
 * resurrect deleted files, double-sync writes, and conflict-rename, all of
 * which break our claim/atomic-write model.
 */
export function detectIncompatibleFilesystem(
  projectDir: string,
): FilesystemCompatIssue | null {
  const abs = resolve(projectDir);
  const home = homedir();
  const os = platform();

  // macOS iCloud Drive
  if (os === "darwin") {
    const icloud = `${home}${sep}Library${sep}Mobile Documents`;
    if (abs.startsWith(icloud + sep) || abs === icloud) {
      return {
        kind: "icloud",
        detail: `path is inside iCloud Drive (${icloud})`,
      };
    }
  }

  // Dropbox (default location, varies; this is best-effort)
  const dropbox = `${home}${sep}Dropbox`;
  if (abs.startsWith(dropbox + sep) || abs === dropbox) {
    return { kind: "dropbox", detail: `path is inside ${dropbox}` };
  }

  // Google Drive (macOS: ~/Library/CloudStorage/GoogleDrive-*; legacy: ~/Google Drive)
  if (os === "darwin") {
    const cloudStorage = `${home}${sep}Library${sep}CloudStorage`;
    if (abs.startsWith(cloudStorage + sep)) {
      return {
        kind: "google-drive",
        detail: `path is inside macOS CloudStorage (${cloudStorage})`,
      };
    }
  }
  const legacyGdrive = `${home}${sep}Google Drive`;
  if (abs.startsWith(legacyGdrive + sep) || abs === legacyGdrive) {
    return { kind: "google-drive", detail: `path is inside ${legacyGdrive}` };
  }

  // OneDrive
  const onedrive = `${home}${sep}OneDrive`;
  if (abs.startsWith(onedrive + sep) || abs === onedrive) {
    return { kind: "onedrive", detail: `path is inside ${onedrive}` };
  }

  return null;
}

/**
 * Throw a clear error when running in an incompatible filesystem unless
 * `force` is set. Used by `init` and the worker bootstrap.
 */
export function assertCompatibleFilesystem(
  projectDir: string,
  force: boolean,
): void {
  const issue = detectIncompatibleFilesystem(projectDir);
  if (!issue) return;
  if (force) return;
  throw new Error(
    `Refusing to operate inside ${issue.kind}: ${issue.detail}.\n` +
      `Sync-overlay filesystems can resurrect deleted files and break atomic ` +
      `claim semantics, which Botholomew depends on for tasks and schedules.\n` +
      `Move the project to a regular local directory, or pass --force to override.`,
  );
}
