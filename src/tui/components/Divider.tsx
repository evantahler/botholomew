import { Text } from "ink";
import { theme } from "../theme.ts";
import { useTtyStdout } from "../useTtyStdout";

interface DividerProps {
  isLoading: boolean;
}

export function Divider({ isLoading }: DividerProps) {
  const { stdout } = useTtyStdout();
  const cols = stdout?.columns ?? 80;
  const line = "─".repeat(cols);

  return <Text color={isLoading ? theme.accent : theme.muted}>{line}</Text>;
}
