import chalk from "chalk";
import { PALETTE } from "./palette.ts";

/**
 * Print a value to stdout. `--json` is raw JSON; human mode is colorized.
 * @param value - Anything JSON-serializable.
 * @param json - Machine mode.
 * @param colorize - Whether to colorize human output.
 */
export function printResult(
  value: unknown,
  json: boolean,
  colorize: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const text = JSON.stringify(value, null, 2);
  process.stdout.write(`${colorize ? chalk.hex(PALETTE.text)(text) : text}\n`);
}

/**
 * Print an error to stderr in the danger color (when color is on).
 * @param message - The error.
 * @param colorize - Whether to colorize.
 */
export function printError(message: string, colorize: boolean): void {
  const text = colorize ? chalk.hex(PALETTE.danger)(message) : message;
  process.stderr.write(`${text}\n`);
}
