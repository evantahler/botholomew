import chalk from "chalk";
import { PALETTE } from "./palette.ts";

/**
 * ASCII banner printed above Commander help: the v1 owl beside the name.
 *
 * Color is applied here rather than in the string itself so `--no-color` and
 * `NO_COLOR` can strip it without a second copy of the art.
 * @param colorize - Whether to apply the accent color.
 * @returns The banner, ending in a newline.
 */
export function helpBanner(colorize: boolean): string {
  const art = [
    "  {o,o}",
    "  /)_)   BOTHOLOMEW",
    '   " "   always-on bot swarms',
  ].join("\n");
  const line = colorize ? chalk.hex(PALETTE.accent)(art) : art;
  return `${line}\n`;
}
