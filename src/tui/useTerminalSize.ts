import { useStdout } from "ink";
import { useEffect, useState } from "react";

/**
 * Track terminal columns + rows. Ink's `useStdout` doesn't re-render on
 * resize, so panels that compute layout from terminal width (e.g. detail
 * panes that wrap long lines) need this hook to stay accurate.
 */
export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => ({
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  }));
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}
