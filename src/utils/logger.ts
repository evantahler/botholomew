import ansis from "ansis";

function ts(): string {
  return ansis.gray(new Date().toTimeString().slice(0, 8));
}

const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
} as const;

type LogLevel = keyof typeof LEVELS;

function parseLevel(raw: string | undefined): number | undefined {
  const key = raw?.toLowerCase();
  if (key && key in LEVELS) return LEVELS[key as LogLevel];
  return undefined;
}

const envPinned = parseLevel(process.env.BOTHOLOMEW_LOG_LEVEL) !== undefined;

function defaultLevel(): number {
  const explicit = parseLevel(process.env.BOTHOLOMEW_LOG_LEVEL);
  if (explicit !== undefined) return explicit;
  if (process.env.NODE_ENV === "test") return LEVELS.error;
  return LEVELS.info;
}

let currentLevel = defaultLevel();

/**
 * Apply a log level from config. `BOTHOLOMEW_LOG_LEVEL` always wins, so
 * this is a no-op when that env var is set. Empty/invalid values are
 * ignored — callers can pass `config.log_level` directly without checking.
 */
export function setLogLevel(level: string | undefined): void {
  if (envPinned) return;
  const parsed = parseLevel(level);
  if (parsed === undefined) return;
  currentLevel = parsed;
}

export const logger = {
  info(msg: string) {
    if (currentLevel < LEVELS.info) return;
    console.log(ts(), ansis.blue("ℹ"), msg);
  },

  success(msg: string) {
    if (currentLevel < LEVELS.info) return;
    console.log(ts(), ansis.green("✓"), msg);
  },

  warn(msg: string) {
    if (currentLevel < LEVELS.warn) return;
    console.log(ts(), ansis.yellow("⚠"), msg);
  },

  error(msg: string) {
    if (currentLevel < LEVELS.error) return;
    console.error(ts(), ansis.red("✗"), msg);
  },

  debug(msg: string) {
    if (currentLevel < LEVELS.debug) return;
    console.log(ts(), ansis.gray("·"), ansis.gray(msg));
  },

  dim(msg: string) {
    if (currentLevel < LEVELS.info) return;
    console.log(ts(), ansis.dim(msg));
  },

  phase(name: string, detail?: string) {
    if (currentLevel < LEVELS.info) return;
    const tag = ansis.magenta.bold(`[[${name}]]`);
    if (detail) {
      console.log(ts(), tag, ansis.dim(detail));
    } else {
      console.log(ts(), tag);
    }
  },
};
