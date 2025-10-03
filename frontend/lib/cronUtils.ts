// Cron expression examples and validation utilities

export interface CronExample {
  expression: string;
  description: string;
}

export const CRON_EXAMPLES: CronExample[] = [
  { expression: "* * * * *", description: "Every minute" },
  { expression: "*/5 * * * *", description: "Every 5 minutes" },
  { expression: "0 * * * *", description: "Every hour (at minute 0)" },
  { expression: "0 */2 * * *", description: "Every 2 hours" },
  { expression: "0 9 * * *", description: "Every day at 9:00 AM" },
  { expression: "0 0 * * *", description: "Every day at midnight" },
  { expression: "0 0 * * 0", description: "Every Sunday at midnight" },
  { expression: "0 0 1 * *", description: "First day of every month" },
  { expression: "0 9 * * 1-5", description: "Weekdays at 9:00 AM" },
];

/**
 * Basic client-side validation for cron expressions
 * Note: This is a simplified check. Full validation happens on the backend.
 */
export function validateCronExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  if (!expression || expression.trim() === "") {
    return { valid: true }; // Empty is valid (optional field)
  }

  const trimmed = expression.trim();

  // Check for predefined expressions
  const predefined = [
    "@yearly",
    "@annually",
    "@monthly",
    "@weekly",
    "@daily",
    "@hourly",
    "@minutely",
    "@secondly",
    "@weekdays",
    "@weekends",
  ];

  if (predefined.includes(trimmed.toLowerCase())) {
    return { valid: true };
  }

  // Basic format check: should have 5 or 6 parts (minute hour day month weekday [second])
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return {
      valid: false,
      error: "Cron expression must have 5 or 6 parts (e.g., '0 * * * *')",
    };
  }

  // Check each part has valid characters
  const validCharsRegex = /^[\d\-\,\*\/]+$/;
  for (const part of parts) {
    if (!validCharsRegex.test(part)) {
      return {
        valid: false,
        error:
          "Invalid characters in cron expression. Use digits, *, -, /, and ,",
      };
    }
  }

  return { valid: true };
}

/**
 * Format a cron expression with a human-readable description if possible
 */
export function describeCronExpression(expression: string): string | null {
  const trimmed = expression.trim();
  const example = CRON_EXAMPLES.find((ex) => ex.expression === trimmed);
  return example ? example.description : null;
}
