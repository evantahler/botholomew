import { Text, useStdout } from "ink";
import { theme } from "../theme.ts";

interface DividerProps {
  isLoading: boolean;
}

export function Divider({ isLoading }: DividerProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const line = "─".repeat(cols);

  return <Text color={isLoading ? theme.accent : theme.muted}>{line}</Text>;
}
