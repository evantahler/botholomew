import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  type ContextEntry,
  listContextDir,
  readContextFile,
} from "../../context/store.ts";
import { isMarkdownPath, renderMarkdown } from "../markdown.ts";

interface ContextPanelProps {
  projectDir: string;
  isActive: boolean;
}

const CHROME_LINES = 8;

export const ContextPanel = memo(function ContextPanel({
  projectDir,
  isActive,
}: ContextPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [preview, setPreview] = useState<{
    entry: ContextEntry;
    content: string;
  } | null>(null);
  const [previewScroll, setPreviewScroll] = useState(0);

  const visibleRows = Math.max(1, termRows - CHROME_LINES);

  useEffect(() => {
    if (cursor < scrollOffset) setScrollOffset(cursor);
    else if (cursor >= scrollOffset + visibleRows) {
      setScrollOffset(cursor - visibleRows + 1);
    }
  }, [cursor, scrollOffset, visibleRows]);

  const refresh = useCallback(
    async (path: string) => {
      try {
        const list = await listContextDir(projectDir, path, {
          recursive: false,
        });
        list.sort((a, b) => {
          if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
          return a.path.localeCompare(b.path);
        });
        setEntries(list);
        setCursor(0);
        setScrollOffset(0);
        setPreview(null);
      } catch {
        setEntries([]);
        setCursor(0);
        setScrollOffset(0);
        setPreview(null);
      }
    },
    [projectDir],
  );

  useEffect(() => {
    refresh(currentPath);
  }, [currentPath, refresh]);

  const previewLines = useMemo(() => {
    if (!preview) return [];
    const body =
      isMarkdownPath(preview.entry.path) && preview.entry.is_textual
        ? renderMarkdown(preview.content)
        : preview.content;
    return body.split("\n");
  }, [preview]);

  const items = entries;
  const itemCount = items.length;
  const visibleItems = useMemo(
    () => items.slice(scrollOffset, scrollOffset + visibleRows),
    [items, scrollOffset, visibleRows],
  );

  useInput(
    (input, key) => {
      if (preview) {
        if (key.upArrow) {
          setPreviewScroll((s) => Math.max(0, s - 1));
          return;
        }
        if (key.downArrow) {
          const maxScroll = Math.max(0, previewLines.length - visibleRows + 2);
          setPreviewScroll((s) => Math.min(maxScroll, s + 1));
          return;
        }
        if (key.escape || input === "q") {
          setPreview(null);
          setPreviewScroll(0);
        }
        return;
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(itemCount - 1, c + 1));
        return;
      }
      if (key.return) {
        const entry = entries[cursor];
        if (!entry) return;
        if (entry.is_directory) {
          setCurrentPath(entry.path);
          return;
        }
        if (!entry.is_textual) return;
        readContextFile(projectDir, entry.path).then((content) => {
          setPreview({ entry, content });
          setPreviewScroll(0);
        });
        return;
      }
      if (key.backspace || key.delete || input === "h") {
        if (currentPath === "") return;
        const parts = currentPath.split("/");
        parts.pop();
        setCurrentPath(parts.join("/"));
      }
      if (input === "r") refresh(currentPath);
    },
    { isActive },
  );

  if (preview) {
    const visiblePreviewLines = previewLines.slice(
      previewScroll,
      previewScroll + visibleRows - 2,
    );
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box>
          <Text bold color="cyan">
            context/{preview.entry.path}
          </Text>
          <Text dimColor> (esc/q to go back · ↑↓ to scroll)</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            {preview.entry.mime_type} · {preview.entry.size} bytes · updated{" "}
            {preview.entry.mtime.toLocaleDateString()}
          </Text>
        </Box>
        <Box
          marginTop={1}
          flexDirection="column"
          flexGrow={1}
          overflow="hidden"
        >
          {visiblePreviewLines.map((line, i) => {
            const lineNum = previewScroll + i;
            return <Text key={lineNum}>{line || " "}</Text>;
          })}
        </Box>
        {previewLines.length > visibleRows - 2 && (
          <Box>
            <Text dimColor>
              [line {previewScroll + 1}–
              {Math.min(previewScroll + visibleRows - 2, previewLines.length)}{" "}
              of {previewLines.length}]
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  const headerLabel =
    currentPath === "" ? "context/" : `context/${currentPath}/`;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box>
        <Text bold color="cyan">
          {headerLabel}
        </Text>
        <Text dimColor>
          {" "}
          ({entries.length} entries · ↑↓ select · ⏎ open · backspace up · r
          refresh)
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {entries.length === 0 && <Text dimColor>(empty)</Text>}
        {visibleItems.map((entry, vi) => {
          const i = vi + scrollOffset;
          const isSelected = i === cursor;
          const name = entry.path.split("/").pop() ?? entry.path;
          const icon = entry.is_directory ? "📁" : "📄";
          return (
            <Box key={entry.path}>
              <Text
                backgroundColor={isSelected ? "#333" : undefined}
                color={
                  isSelected ? "cyan" : entry.is_directory ? "blue" : undefined
                }
                bold={isSelected}
              >
                {"  "}
                {icon} {name}
                {entry.is_directory ? "/" : ""}
                {!entry.is_directory && (
                  <Text dimColor> ({entry.mime_type})</Text>
                )}
              </Text>
            </Box>
          );
        })}
      </Box>
      {itemCount > visibleRows && (
        <Box>
          <Text dimColor>
            [{scrollOffset + 1}–
            {Math.min(scrollOffset + visibleRows, itemCount)} of {itemCount}]
          </Text>
        </Box>
      )}
    </Box>
  );
});
