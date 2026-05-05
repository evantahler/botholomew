import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { theme } from "../theme.ts";

interface SleepProgressProps {
  startedAt: Date;
  totalSeconds: number;
  reason?: string;
}

const BAR_WIDTH = 24;
const TICK_MS = 200;

export function SleepProgress({
  startedAt,
  totalSeconds,
  reason,
}: SleepProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const totalMs = totalSeconds * 1000;
  const elapsedMs = Math.min(totalMs, Math.max(0, now - startedAt.getTime()));
  const ratio = totalMs > 0 ? elapsedMs / totalMs : 1;
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{"    "}</Text>
        <Text color={theme.accent}>{bar}</Text>
        <Text dimColor>
          {" "}
          {elapsedSec}s / {totalSeconds}s
        </Text>
      </Box>
      {reason && (
        <Text dimColor wrap="truncate-end">
          {"    "}
          {reason}
        </Text>
      )}
    </Box>
  );
}

/**
 * Pull `seconds` and `reason` out of a sleep tool's stringified JSON input.
 * Returns `null` if the input can't be parsed or doesn't have a numeric duration.
 */
export function parseSleepInput(
  raw: string,
): { seconds: number; reason?: string } | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.seconds !== "number") return null;
    return {
      seconds: parsed.seconds,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}
