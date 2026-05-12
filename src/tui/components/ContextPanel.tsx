import { Box, Text, useInput } from "ink";
import type { MembotClient } from "membot";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { openMembot } from "../../mem/client.ts";
import {
  detailPaneBorderProps,
  type FocusState,
  handleListDetailKey,
} from "../listDetailKeys.ts";
import { isMarkdownPath, renderMarkdown } from "../markdown.ts";
import { theme } from "../theme.ts";
import { useDeleteConfirm } from "../useDeleteConfirm.ts";
import { useLatestRef } from "../useLatestRef.ts";
import { useTerminalSize } from "../useTerminalSize.ts";
import { wrapDetailLines } from "../wrapDetail.ts";
import { DeleteArmedBanner } from "./DeleteArmedBanner.tsx";
import { Scrollbar } from "./Scrollbar.tsx";

interface ContextPanelProps {
  projectDir: string;
  isActive: boolean;
}

interface ContextEntry {
  logical_path: string;
  version_id: string;
  size_bytes: number | null;
  mime_type: string | null;
  description: string | null;
}

const SIDEBAR_WIDTH = 40;
const PAGE_SCROLL_LINES = 10;

/**
 * Browse the membot knowledge store. Each row is a current-version entry; the
 * detail pane shows the cleaned markdown surrogate. Membot has no real
 * directories — `logical_path` segments are just slashes — so this is a flat
 * paginated list rather than a tree drill-in. Use `botholomew context tree` /
 * `botholomew context search` for hierarchical or content-based discovery.
 */
export const ContextPanel = memo(function ContextPanel({
  projectDir,
  isActive,
}: ContextPanelProps) {
  const { rows: termRows, cols: termCols } = useTerminalSize();
  const detailWidth = Math.max(1, termCols - SIDEBAR_WIDTH - 5);

  // One MembotClient per panel mount. Membot manages its DB lock per-op so
  // sharing the file with the chat session / workers is safe.
  const [client, setClient] = useState<MembotClient | null>(null);
  useEffect(() => {
    const c = openMembot(projectDir);
    setClient(c);
    return () => {
      void c.close();
    };
  }, [projectDir]);

  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");
  const [fileContent, setFileContent] = useState<{
    logical_path: string;
    content: string;
  } | null>(null);

  const visibleRows = Math.max(1, termRows - 6);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const out = await client.list({ limit: 500 });
      const list = out.entries.map((e) => ({
        logical_path: e.logical_path,
        version_id: e.version_id,
        size_bytes: e.size_bytes,
        mime_type: e.mime_type,
        description: e.description,
      }));
      list.sort((a, b) => a.logical_path.localeCompare(b.logical_path));
      setEntries(list);
      setSelectedIndex(0);
      setSidebarScrollOffset(0);
    } catch {
      setEntries([]);
      setSelectedIndex(0);
      setSidebarScrollOffset(0);
    }
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedIndex < sidebarScrollOffset) {
      setSidebarScrollOffset(selectedIndex);
    } else if (selectedIndex >= sidebarScrollOffset + visibleRows) {
      setSidebarScrollOffset(selectedIndex - visibleRows + 1);
    }
  }, [selectedIndex, sidebarScrollOffset, visibleRows]);

  const selectedEntry = entries[selectedIndex];

  useEffect(() => {
    let cancelled = false;
    if (!selectedEntry || !client) {
      setFileContent(null);
      setDetailScroll(0);
      return;
    }
    setDetailScroll(0);
    client
      .read({ logical_path: selectedEntry.logical_path })
      .then((result) => {
        if (cancelled) return;
        setFileContent({
          logical_path: selectedEntry.logical_path,
          content: result.content ?? "",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFileContent({
          logical_path: selectedEntry.logical_path,
          content: "(failed to read this entry — it may have been removed)",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedEntry]);

  const detailLines = useMemo(() => {
    if (!fileContent || !selectedEntry) return [];
    const body = isMarkdownPath(fileContent.logical_path)
      ? renderMarkdown(fileContent.content)
      : fileContent.content;
    return wrapDetailLines(body, detailWidth);
  }, [fileContent, selectedEntry, detailWidth]);

  const visibleDetailRows = Math.max(1, visibleRows - 2);
  const maxDetailScroll = Math.max(0, detailLines.length - visibleDetailRows);

  const visibleItems = useMemo(
    () => entries.slice(sidebarScrollOffset, sidebarScrollOffset + visibleRows),
    [entries, sidebarScrollOffset, visibleRows],
  );

  const itemCountRef = useLatestRef(entries.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const selectedEntryRef = useLatestRef(selectedEntry);
  const focusRef = useLatestRef(focus);

  const deleteConfirm = useDeleteConfirm(() => {
    const entry = selectedEntryRef.current;
    if (!entry || !client) return;
    const path = entry.logical_path;
    (async () => {
      try {
        await client.remove({ paths: [path] });
      } catch {
        // ignore — refresh will reflect any partial state
      }
      refresh();
    })();
  });

  useInput(
    (input, key) => {
      if (input !== "d") deleteConfirm.cancel();

      if (
        handleListDetailKey(input, key, {
          focusRef,
          setFocus,
          itemCountRef,
          maxDetailScrollRef,
          setSelectedIndex,
          setDetailScroll,
          pageScrollLines: PAGE_SCROLL_LINES,
        })
      ) {
        return;
      }

      if (input === "d") {
        const entry = selectedEntryRef.current;
        if (!entry) return;
        deleteConfirm.pressDelete(entry.logical_path);
        return;
      }
      if (key.ctrl && (input === "r" || input === "R")) {
        refresh();
        return;
      }
    },
    { isActive },
  );

  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleDetailRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
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
            membot ({entries.length})
          </Text>
        </Box>
        {entries.length === 0 ? (
          <Box paddingX={1}>
            <Text dimColor>(empty — try `botholomew context add …`)</Text>
          </Box>
        ) : (
          visibleItems.map((entry, vi) => {
            const i = vi + sidebarScrollOffset;
            const isSelected = i === selectedIndex;
            return (
              <Box key={entry.logical_path} paddingX={1}>
                <Text
                  backgroundColor={isSelected ? theme.selectionBg : undefined}
                  color={isSelected ? theme.info : undefined}
                  bold={isSelected}
                  wrap="truncate-end"
                >
                  {isSelected ? "▸" : " "} {entry.logical_path}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

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
            <ContextDetailHeader entry={selectedEntry} />
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
              <Box flexDirection="column" flexGrow={1} overflow="hidden">
                {detailVisible.map((line, i) => {
                  const lineNum = detailScroll + i;
                  return (
                    <Text key={lineNum} wrap="truncate-end">
                      {line || " "}
                    </Text>
                  );
                })}
              </Box>
              <Scrollbar
                total={detailLines.length}
                visible={visibleDetailRows - 3}
                offset={detailScroll}
                height={visibleDetailRows - 3}
                focused={focus === "detail"}
              />
            </Box>
          </>
        ) : (
          <Text dimColor>(no entry selected)</Text>
        )}
        <DeleteArmedBanner
          armed={deleteConfirm.armed}
          label={deleteConfirm.armedLabel}
        />
        <Box>
          <Text dimColor>
            {focus === "detail"
              ? "↑↓ scroll · ⇧↑↓ page · g/G top/bot · ← back to list"
              : "↑↓ select · → detail · d delete (×2) · ^R refresh"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});

function formatSize(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ContextDetailHeader({ entry }: { entry: ContextEntry }) {
  return (
    <Box flexDirection="column" width="100%" backgroundColor={theme.headerBg}>
      <Box>
        <Text bold color="cyan" wrap="truncate-end">
          📄 {entry.logical_path}
        </Text>
      </Box>
      <Box>
        <Text dimColor wrap="truncate-end">
          {entry.mime_type ?? "?"} · {formatSize(entry.size_bytes)} · v=
          {entry.version_id}
        </Text>
      </Box>
      {entry.description ? (
        <Box>
          <Text dimColor wrap="truncate-end">
            {entry.description}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
