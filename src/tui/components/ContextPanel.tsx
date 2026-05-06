import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { getDbPath } from "../../constants.ts";
import {
  type ContextEntry,
  listContextDir,
  readContextFile,
} from "../../context/store.ts";
import { withDb } from "../../db/connection.ts";
import {
  getIndexedPath,
  type IndexedPathSummary,
} from "../../db/embeddings.ts";
import {
  detailPaneBorderProps,
  type FocusState,
  handleListDetailKey,
} from "../listDetailKeys.ts";
import { isMarkdownPath, renderMarkdown } from "../markdown.ts";
import { theme } from "../theme.ts";
import { useLatestRef } from "../useLatestRef.ts";
import { Scrollbar } from "./Scrollbar.tsx";

interface ContextPanelProps {
  projectDir: string;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 32;
const PAGE_SCROLL_LINES = 10;

export const ContextPanel = memo(function ContextPanel({
  projectDir,
  isActive,
}: ContextPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");
  const [fileContent, setFileContent] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [indexStatus, setIndexStatus] = useState<{
    path: string;
    summary: IndexedPathSummary | null;
  } | null>(null);

  const visibleRows = Math.max(1, termRows - 6);

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
        setSelectedIndex(0);
        setSidebarScrollOffset(0);
      } catch {
        setEntries([]);
        setSelectedIndex(0);
        setSidebarScrollOffset(0);
      }
    },
    [projectDir],
  );

  useEffect(() => {
    refresh(currentPath);
  }, [currentPath, refresh]);

  // Keep the sidebar's selection visible by scrolling its viewport when the
  // cursor approaches the edges.
  useEffect(() => {
    if (selectedIndex < sidebarScrollOffset) {
      setSidebarScrollOffset(selectedIndex);
    } else if (selectedIndex >= sidebarScrollOffset + visibleRows) {
      setSidebarScrollOffset(selectedIndex - visibleRows + 1);
    }
  }, [selectedIndex, sidebarScrollOffset, visibleRows]);

  const selectedEntry = entries[selectedIndex];

  // Auto-load file content when the selection lands on a textual file.
  // Folders and non-textual files clear the right pane.
  useEffect(() => {
    let cancelled = false;
    if (!selectedEntry) {
      setFileContent(null);
      setDetailScroll(0);
      return;
    }
    if (selectedEntry.is_directory || !selectedEntry.is_textual) {
      setFileContent(null);
      setDetailScroll(0);
      return;
    }
    setDetailScroll(0);
    readContextFile(projectDir, selectedEntry.path).then((content) => {
      if (cancelled) return;
      setFileContent({ path: selectedEntry.path, content });
    });
    return () => {
      cancelled = true;
    };
  }, [projectDir, selectedEntry]);

  // Look up the file's index status so we can show "indexed (N chunks)"
  // vs "not indexed" in the header. Skips for folders.
  useEffect(() => {
    let cancelled = false;
    if (!selectedEntry || selectedEntry.is_directory) {
      setIndexStatus(null);
      return;
    }
    const path = selectedEntry.path;
    const dbPath = getDbPath(projectDir);
    withDb(dbPath, (conn) => getIndexedPath(conn, path))
      .then((summary) => {
        if (cancelled) return;
        setIndexStatus({ path, summary });
      })
      .catch(() => {
        if (cancelled) return;
        setIndexStatus({ path, summary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [projectDir, selectedEntry]);

  const detailLines = useMemo(() => {
    if (!fileContent || !selectedEntry) return [];
    const body = isMarkdownPath(fileContent.path)
      ? renderMarkdown(fileContent.content)
      : fileContent.content;
    return body.split("\n");
  }, [fileContent, selectedEntry]);

  const visibleDetailRows = Math.max(1, visibleRows - 2);
  const maxDetailScroll = Math.max(0, detailLines.length - visibleDetailRows);

  const visibleItems = useMemo(
    () => entries.slice(sidebarScrollOffset, sidebarScrollOffset + visibleRows),
    [entries, sidebarScrollOffset, visibleRows],
  );

  // Refs read by the keyboard handler so it always sees the latest committed
  // values (Ink 7's useInput intermittently leaves a stale closure).
  const itemCountRef = useLatestRef(entries.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const selectedEntryRef = useLatestRef(selectedEntry);
  const currentPathRef = useLatestRef(currentPath);
  const focusRef = useLatestRef(focus);

  useInput(
    (input, key) => {
      if (
        handleListDetailKey(input, key, {
          focusRef,
          setFocus,
          itemCountRef,
          maxDetailScrollRef,
          setSelectedIndex,
          setDetailScroll,
          pageScrollLines: PAGE_SCROLL_LINES,
          // Context-specific: → on a folder drills in (when list-focused);
          // ← in list-focus goes up a directory.
          onRightArrow: () => {
            if (focusRef.current !== "list") return false;
            const entry = selectedEntryRef.current;
            if (entry?.is_directory) {
              setCurrentPath(entry.path);
              return true;
            }
            return false;
          },
          onLeftArrow: () => {
            if (focusRef.current !== "list") return false;
            const cwd = currentPathRef.current;
            if (cwd === "") return true; // already at root, swallow the key
            const parts = cwd.split("/");
            parts.pop();
            setCurrentPath(parts.join("/"));
            return true;
          },
        })
      ) {
        return;
      }

      if (input === "r") {
        refresh(currentPathRef.current);
      }
    },
    { isActive },
  );

  const headerLabel =
    currentPath === "" ? "context/" : `context/${currentPath}/`;

  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleDetailRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
      {/* Left: file tree */}
      <Box
        flexDirection="column"
        width={SIDEBAR_WIDTH}
        height={visibleRows + 1}
        borderStyle="single"
        borderColor={theme.muted}
        borderRight
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        overflow="hidden"
      >
        <Box paddingX={1}>
          <Text bold dimColor wrap="truncate-end">
            {headerLabel}
          </Text>
        </Box>
        {entries.length === 0 ? (
          <Box paddingX={1}>
            <Text dimColor>(empty)</Text>
          </Box>
        ) : (
          visibleItems.map((entry, vi) => {
            const i = vi + sidebarScrollOffset;
            const isSelected = i === selectedIndex;
            const name = entry.path.split("/").pop() ?? entry.path;
            const icon = entry.is_directory ? "📁" : "📄";
            return (
              <Box key={entry.path} paddingX={1}>
                <Text
                  backgroundColor={isSelected ? theme.selectionBg : undefined}
                  color={
                    isSelected
                      ? theme.info
                      : entry.is_directory
                        ? theme.accent
                        : undefined
                  }
                  bold={isSelected}
                  wrap="truncate-end"
                >
                  {isSelected ? "▸" : " "} {icon} {name}
                  {entry.is_directory ? "/" : ""}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Right: file content (or placeholder) */}
      <Box
        flexDirection="column"
        flexGrow={1}
        height={visibleRows + 1}
        paddingX={1}
        {...detailPaneBorderProps(focus)}
        overflow="hidden"
      >
        {selectedEntry ? (
          <>
            <ContextDetailHeader
              entry={selectedEntry}
              indexStatus={
                indexStatus && indexStatus.path === selectedEntry.path
                  ? indexStatus.summary
                  : null
              }
              indexLoaded={
                !!indexStatus && indexStatus.path === selectedEntry.path
              }
            />
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
              <Box flexDirection="column" flexGrow={1} overflow="hidden">
                {selectedEntry.is_directory ? (
                  <Text dimColor>(folder — press → to drill in)</Text>
                ) : !selectedEntry.is_textual ? (
                  <Text dimColor>(binary file — no preview)</Text>
                ) : (
                  detailVisible.map((line, i) => {
                    const lineNum = detailScroll + i;
                    return (
                      <Text key={lineNum} wrap="truncate-end">
                        {line || " "}
                      </Text>
                    );
                  })
                )}
              </Box>
              {selectedEntry &&
                !selectedEntry.is_directory &&
                selectedEntry.is_textual && (
                  <Scrollbar
                    total={detailLines.length}
                    visible={visibleDetailRows - 3}
                    offset={detailScroll}
                    height={visibleDetailRows - 3}
                    focused={focus === "detail"}
                  />
                )}
            </Box>
          </>
        ) : (
          <Text dimColor>(no item selected)</Text>
        )}
        <Box>
          <Text dimColor>
            {focus === "detail"
              ? "↑↓ scroll · ⇧↑↓ page · g/G top/bot · ← back to list"
              : "↑↓ select · → drill in/enter detail · ← up · r refresh"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date): string {
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContextDetailHeader({
  entry,
  indexStatus,
  indexLoaded,
}: {
  entry: ContextEntry;
  indexStatus: IndexedPathSummary | null;
  indexLoaded: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan" wrap="truncate-end">
          {entry.is_directory ? "📁" : "📄"} context/{entry.path}
          {entry.is_directory ? "/" : ""}
        </Text>
      </Box>
      {entry.is_directory ? (
        <Box>
          <Text dimColor wrap="truncate-end">
            directory · → to open
          </Text>
        </Box>
      ) : (
        <>
          <Box>
            <Text dimColor wrap="truncate-end">
              {entry.mime_type} · {formatSize(entry.size)} · updated{" "}
              {formatDate(entry.mtime)}
            </Text>
          </Box>
          <Box>
            <Text wrap="truncate-end">
              {!indexLoaded ? (
                <Text dimColor>checking index…</Text>
              ) : indexStatus ? (
                <Text color={theme.success}>
                  ● indexed
                  <Text dimColor>
                    {" ("}
                    {indexStatus.chunk_count}
                    {indexStatus.chunk_count === 1 ? " chunk" : " chunks"})
                  </Text>
                </Text>
              ) : (
                <Text color={theme.muted}>○ not indexed</Text>
              )}
            </Text>
          </Box>
        </>
      )}
      <Box>
        <Text dimColor>{"─".repeat(2)}</Text>
      </Box>
    </Box>
  );
}
