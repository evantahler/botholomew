import { useStdout } from "ink";
import { useEffect, useState } from "react";

// Track the terminal's row count so the dynamic frame stays strictly below
// fullscreen. Ink 7 wipes scrollback whenever the dynamic frame is overflowing
// or transitions out of fullscreen — so as long as the rendered output height
// stays < `rows` on every render, scrollback is preserved.
export function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return rows;
}
