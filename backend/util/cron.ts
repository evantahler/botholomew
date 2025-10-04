import { CronExpressionParser } from "cron-parser";

export function validateCronExpression(schedule: string): boolean {
  try {
    CronExpressionParser.parse(schedule);
    return true;
  } catch {
    return false;
  }
}
