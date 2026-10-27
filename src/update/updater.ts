// The single configured self-updater for the Botholomew CLI.
//
// The self-update + version-check logic used to live in-tree under
// `src/update/{checker,cache,background}.ts`. It has since been extracted into
// the reusable `upgradr` package, so this module is a thin binding that wires
// our package metadata into `createUpdater`. Every call site (the `upgrade` and
// `check-update` commands, and the background startup notice in `cli.ts`) goes
// through this singleton.
import { createUpdater } from "upgradr";
import { ENV, HOME_CONFIG_DIR } from "../constants.ts";
import { pkg } from "../pkg.ts";

// "https://github.com/evantahler/botholomew.git" → "evantahler/botholomew"
const GITHUB_REPO = (pkg.repository.url as string)
  .replace(/^https:\/\/github\.com\//, "")
  .replace(/\.git$/, "");

export const updater = createUpdater({
  currentVersion: pkg.version,
  packageName: pkg.name, // "botholomew" — npm registry lookup + `install -g`
  repo: GITHUB_REPO,
  binaryName: pkg.name, // release asset prefix → botholomew-<os>-<arch>[.exe]
  cacheDir: HOME_CONFIG_DIR, // ~/.botholomew/update.json
  cliName: pkg.name, // drives the "Run `botholomew upgrade`" notice text
  noUpdateCheckEnv: ENV.NO_UPDATE_CHECK, // "BOTHOLOMEW_NO_UPDATE_CHECK"
  // The library never writes to the console itself — surface its progress
  // (e.g. sudo prompts during a binary swap) on stderr.
  onProgress: (msg) => process.stderr.write(`${msg}\n`),
});
