import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useState } from "react";
import type { LinkEntry } from "../links.ts";
import { copyToClipboard, openUrl } from "../shellOpen.ts";
import { theme } from "../theme.ts";

interface LinkPickerProps {
  links: LinkEntry[];
  open: boolean;
  onClose: () => void;
}

/** Break a URL into fixed-width chunks so the whole thing is visible at once. */
export function chunk(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    out.push(text.slice(i, i + width));
  }
  return out.length > 0 ? out : [""];
}

const MAX_VISIBLE = 8;

/**
 * Inline picker over every URL seen this session (Ctrl+L).
 *
 * The terminal hard-wraps a long URL at the viewport edge, so selecting one out
 * of scrollback picks up embedded newlines — the exact failure that makes an
 * OAuth link unusable. `c` copies the URL as a single string instead; `o` hands
 * it straight to the browser. While open this owns the keyboard, the same way
 * `ApprovalPrompt` does.
 */
export function LinkPicker({ links, open, onClose }: LinkPickerProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const [selected, setSelected] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(0);
      setShowRaw(false);
      setStatus(null);
    }
  }, [open]);

  useInput(
    (input, key) => {
      if (key.escape || input === "q") {
        onClose();
        return;
      }
      if (key.upArrow || input === "k") {
        setSelected((i) => Math.max(0, i - 1));
        setStatus(null);
        return;
      }
      if (key.downArrow || input === "j") {
        setSelected((i) => Math.min(links.length - 1, i + 1));
        setStatus(null);
        return;
      }
      if (input === "v") {
        setShowRaw((v) => !v);
        return;
      }
      const url = links[selected]?.url;
      if (!url) return;
      if (input === "o") {
        setStatus("opening…");
        void openUrl(url).then((r) =>
          setStatus(r.ok ? "opened in browser" : `open failed: ${r.error}`),
        );
      } else if (input === "c") {
        setStatus("copying…");
        void copyToClipboard(url).then((r) =>
          setStatus(r.ok ? "copied to clipboard" : `copy failed: ${r.error}`),
        );
      }
    },
    { isActive: open },
  );

  if (!open) return null;

  if (links.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.accentBorder}
        paddingX={1}
        flexDirection="column"
      >
        <Text color={theme.accent} bold>
          ⇗ Links
        </Text>
        <Text color={theme.muted}>
          No links yet — this lists every URL Botholomew has shown you.
        </Text>
        <Text color={theme.muted}>Esc close</Text>
      </Box>
    );
  }

  // Keep the selection centered once the list outgrows the window.
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(MAX_VISIBLE / 2),
      links.length - MAX_VISIBLE,
    ),
  );
  const visible = links.slice(start, start + MAX_VISIBLE);
  const current = links[selected];
  const rawWidth = Math.max(20, cols - 8);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accentBorder}
      paddingX={1}
    >
      <Text color={theme.accent} bold>
        ⇗ Links ({selected + 1}/{links.length})
      </Text>
      {visible.map((link, i) => {
        const idx = start + i;
        const active = idx === selected;
        return (
          <Text
            key={link.url}
            {...(active ? { backgroundColor: theme.selectionBg } : {})}
            wrap="truncate-end"
          >
            <Text color={active ? theme.accent : theme.muted}>
              {active ? "❯ " : "  "}
            </Text>
            <Text color={active ? theme.info : undefined}>{link.label}</Text>
            <Text color={theme.muted}> — {link.source}</Text>
          </Text>
        );
      })}
      {showRaw && current && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginTop={1}
        >
          {chunk(current.url, rawWidth).map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-width slices
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      )}
      {status && <Text color={theme.info}>{status}</Text>}
      <Text>
        <Text color={theme.success} bold>
          o
        </Text>{" "}
        open ·{" "}
        <Text color={theme.info} bold>
          c
        </Text>{" "}
        copy ·{" "}
        <Text color={theme.accent} bold>
          v
        </Text>{" "}
        {showRaw ? "hide" : "show"} full URL · ↑↓ select ·{" "}
        <Text color={theme.error} bold>
          q
        </Text>
        /Esc close
      </Text>
    </Box>
  );
}
