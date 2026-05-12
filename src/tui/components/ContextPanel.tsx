import { Box, Text, useInput } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { loadConfig } from "../../config/loader.ts";
import { resolveMembotDir, scopedWithMem } from "../../mem/client.ts";
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

interface SearchHit {
  logical_path: string;
  version_id: string;
  chunk_index: number;
  snippet: string;
  score: number;
}

type SidebarRow =
  | {
      kind: "dir";
      name: string;
      full_path: string;
      child_count: number;
    }
  | { kind: "file"; entry: ContextEntry }
  | { kind: "hit"; hit: SearchHit };

type ViewMode = "tree" | "search";

const SIDEBAR_WIDTH = 40;
const PAGE_SCROLL_LINES = 10;
const LIST_LIMIT = 1000;
const SEARCH_LIMIT = 50;

/**
 * Browse the membot knowledge store. Two modes share the panel:
 *
 *   tree   — sidebar shows the immediate children (directories + files)
 *            of a `currentPrefix` segment of the logical-path namespace.
 *            `→` on a directory drills in; `←` from the list pops one
 *            segment back up. Directories are synthesised from `/`
 *            separators in `logical_path` (membot has no real folders).
 *
 *   search — `/` or `s` opens an inline input; `Enter` runs hybrid
 *            semantic + BM25 search via `mem.search()` and replaces the
 *            sidebar with ranked hits + snippets. `Esc` returns to tree.
 *
 * The DuckDB lock is opened per op (`scopedWithMem`) — never held for the
 * panel's mount lifetime — so concurrent workers / chat turns / the
 * membot CLI can claim the shared `~/.membot` store while this panel
 * sits idle.
 */
export const ContextPanel = memo(function ContextPanel({
  projectDir,
  isActive,
}: ContextPanelProps) {
  const { rows: termRows, cols: termCols } = useTerminalSize();
  const detailWidth = Math.max(1, termCols - SIDEBAR_WIDTH - 5);

  const [membotDir, setMembotDir] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await loadConfig(projectDir);
      if (cancelled) return;
      setMembotDir(resolveMembotDir(projectDir, config));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDir]);
  const withMem = useMemo(
    () => (membotDir ? scopedWithMem(membotDir) : null),
    [membotDir],
  );

  const [mode, setMode] = useState<ViewMode>("tree");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRunning, setSearchRunning] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");
  const [fileContent, setFileContent] = useState<{
    logical_path: string;
    content: string;
  } | null>(null);

  const visibleRows = Math.max(1, termRows - 6);

  const loadTree = useCallback(
    async (prefix: string) => {
      if (!withMem) return;
      try {
        const out = await withMem((mem) =>
          mem.list({ prefix: prefix || undefined, limit: LIST_LIMIT }),
        );
        setEntries(
          out.entries.map((e) => ({
            logical_path: e.logical_path,
            version_id: e.version_id,
            size_bytes: e.size_bytes,
            mime_type: e.mime_type,
            description: e.description,
          })),
        );
      } catch {
        setEntries([]);
      }
      setSelectedIndex(0);
      setSidebarScrollOffset(0);
    },
    [withMem],
  );

  useEffect(() => {
    if (mode === "tree") loadTree(currentPrefix);
  }, [mode, currentPrefix, loadTree]);

  // Derived: immediate children at `currentPrefix`. Directories are
  // grouped by their first remaining segment; files are entries whose
  // suffix has no further `/`.
  const treeRows: SidebarRow[] = useMemo(() => {
    const dirs = new Map<string, number>();
    const files: ContextEntry[] = [];
    for (const e of entries) {
      if (!e.logical_path.startsWith(currentPrefix)) continue;
      const suffix = e.logical_path.slice(currentPrefix.length);
      if (!suffix) continue;
      const slash = suffix.indexOf("/");
      if (slash < 0) {
        files.push(e);
      } else {
        const name = suffix.slice(0, slash);
        dirs.set(name, (dirs.get(name) ?? 0) + 1);
      }
    }
    const dirRows: SidebarRow[] = [...dirs.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({
        kind: "dir",
        name,
        full_path: currentPrefix + name,
        child_count: count,
      }));
    const fileRows: SidebarRow[] = files
      .sort((a, b) => a.logical_path.localeCompare(b.logical_path))
      .map((entry) => ({ kind: "file", entry }));
    return [...dirRows, ...fileRows];
  }, [entries, currentPrefix]);

  const searchRows: SidebarRow[] = useMemo(
    () => searchResults.map((hit) => ({ kind: "hit", hit })),
    [searchResults],
  );

  const rows = mode === "tree" ? treeRows : searchRows;
  const selectedRow = rows[selectedIndex];

  useEffect(() => {
    if (selectedIndex < sidebarScrollOffset) {
      setSidebarScrollOffset(selectedIndex);
    } else if (selectedIndex >= sidebarScrollOffset + visibleRows) {
      setSidebarScrollOffset(selectedIndex - visibleRows + 1);
    }
  }, [selectedIndex, sidebarScrollOffset, visibleRows]);

  // Fetch detail content for the selected row.
  const selectedReadPath = useMemo(() => {
    if (!selectedRow) return null;
    if (selectedRow.kind === "file") return selectedRow.entry.logical_path;
    if (selectedRow.kind === "hit") return selectedRow.hit.logical_path;
    return null; // directory rows have no readable body
  }, [selectedRow]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedReadPath || !withMem) {
      setFileContent(null);
      setDetailScroll(0);
      return;
    }
    setDetailScroll(0);
    withMem((mem) => mem.read({ logical_path: selectedReadPath }))
      .then((result) => {
        if (cancelled) return;
        setFileContent({
          logical_path: selectedReadPath,
          content: result.content ?? "",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFileContent({
          logical_path: selectedReadPath,
          content: "(failed to read this entry — it may have been removed)",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [withMem, selectedReadPath]);

  const detailLines = useMemo(() => {
    if (!selectedRow) return [];
    if (selectedRow.kind === "dir") {
      const body = `📁 ${selectedRow.full_path}/\n\n${selectedRow.child_count} item${selectedRow.child_count === 1 ? "" : "s"} under this prefix.\n\nPress → to drill in.`;
      return wrapDetailLines(body, detailWidth);
    }
    if (!fileContent) return [];
    const snippetHeader =
      selectedRow.kind === "hit"
        ? `🔍 match (score=${selectedRow.hit.score.toFixed(3)}, chunk #${selectedRow.hit.chunk_index})\n${selectedRow.hit.snippet}\n\n---\n\n`
        : "";
    const body = isMarkdownPath(fileContent.logical_path)
      ? renderMarkdown(fileContent.content)
      : fileContent.content;
    return wrapDetailLines(snippetHeader + body, detailWidth);
  }, [selectedRow, fileContent, detailWidth]);

  const visibleDetailRows = Math.max(1, visibleRows - 2);
  const maxDetailScroll = Math.max(0, detailLines.length - visibleDetailRows);

  const visibleItems = useMemo(
    () => rows.slice(sidebarScrollOffset, sidebarScrollOffset + visibleRows),
    [rows, sidebarScrollOffset, visibleRows],
  );

  const itemCountRef = useLatestRef(rows.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const selectedRowRef = useLatestRef(selectedRow);
  const focusRef = useLatestRef(focus);
  const modeRef = useLatestRef(mode);
  const currentPrefixRef = useLatestRef(currentPrefix);
  const searchingRef = useLatestRef(searching);

  const refresh = useCallback(async () => {
    if (modeRef.current === "tree") {
      await loadTree(currentPrefixRef.current);
    }
    // Search results are a snapshot of a user-issued query; ^R doesn't
    // re-run the query (it might be expensive and the user can re-press
    // `/` and Enter).
  }, [loadTree, modeRef, currentPrefixRef]);

  const runSearch = useCallback(
    async (query: string) => {
      if (!withMem) return;
      const trimmed = query.trim();
      if (!trimmed) return;
      // Flip into search mode synchronously so the sidebar shows the
      // "🔍 query (searching…)" state immediately — otherwise the user
      // sees no visible change between pressing Enter and the embedding
      // round-trip completing.
      setMode("search");
      setSearchResults([]);
      setSearchRunning(true);
      setSearchError(null);
      setSelectedIndex(0);
      setSidebarScrollOffset(0);
      try {
        const out = await withMem((mem) =>
          mem.search({ query: trimmed, pattern: trimmed, limit: SEARCH_LIMIT }),
        );
        setSearchResults(
          out.hits.map((h) => ({
            logical_path: h.logical_path,
            version_id: h.version_id,
            chunk_index: h.chunk_index,
            snippet: h.snippet,
            score: h.score,
          })),
        );
      } catch (err) {
        setSearchResults([]);
        setSearchError(err instanceof Error ? err.message : String(err));
      } finally {
        setSearchRunning(false);
      }
    },
    [withMem],
  );

  const exitSearch = useCallback(() => {
    setMode("tree");
    setSearchResults([]);
    setSearchQuery("");
    setSearchError(null);
    setSelectedIndex(0);
    setSidebarScrollOffset(0);
  }, []);

  // Debounced live search. While the user is in search-typing mode (or
  // has committed a non-empty query and we're still on the search view),
  // any change to `searchQuery` schedules a `mem.search()` 300ms later.
  // Subsequent keystrokes within the window reset the timer, so a fast
  // typist makes at most one DB-lock round-trip per pause. The 300ms
  // figure keeps the DB lock available to workers / chat between bursts
  // without feeling laggy to the user.
  useEffect(() => {
    if (mode !== "search") return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError(null);
      setSearchRunning(false);
      return;
    }
    const handle = setTimeout(() => {
      runSearch(trimmed);
    }, 300);
    return () => clearTimeout(handle);
  }, [mode, searchQuery, runSearch]);

  const drillIn = useCallback((dirFullPath: string) => {
    setCurrentPrefix(`${dirFullPath}/`);
    setSelectedIndex(0);
    setSidebarScrollOffset(0);
    setFocus("list");
  }, []);

  const popPrefix = useCallback(() => {
    const prefix = currentPrefixRef.current;
    if (!prefix) return false;
    // prefix always ends in "/"; strip it, then remove the last segment.
    const trimmed = prefix.replace(/\/$/, "");
    const slash = trimmed.lastIndexOf("/");
    const next = slash < 0 ? "" : `${trimmed.slice(0, slash)}/`;
    setCurrentPrefix(next);
    setSelectedIndex(0);
    setSidebarScrollOffset(0);
    return true;
  }, [currentPrefixRef]);

  const deleteConfirm = useDeleteConfirm(() => {
    const row = selectedRowRef.current;
    if (!row || !withMem) return;
    if (row.kind === "dir") {
      const path = row.full_path;
      (async () => {
        try {
          await withMem((mem) =>
            mem.remove({ paths: [path], recursive: true }),
          );
        } catch {
          // ignore — refresh will reflect any partial state
        }
        await refresh();
      })();
      return;
    }
    const path =
      row.kind === "file" ? row.entry.logical_path : row.hit.logical_path;
    (async () => {
      try {
        await withMem((mem) => mem.remove({ paths: [path] }));
      } catch {
        // ignore — refresh will reflect any partial state
      }
      if (modeRef.current === "search") {
        // Drop the deleted hit from the local results so the list updates.
        setSearchResults((prev) => prev.filter((h) => h.logical_path !== path));
        setSelectedIndex((i) =>
          Math.max(0, Math.min(i, searchRows.length - 2)),
        );
      } else {
        await refresh();
      }
    })();
  });

  useInput(
    (input, key) => {
      // Search-typing mode: capture characters; the debounced effect on
      // `searchQuery` does the actual `mem.search()` call. Enter closes
      // the input bar but leaves results visible. Esc cancels back to
      // tree. Arrow keys and other navigation fall through to
      // handleListDetailKey below so the user can ↑↓ through results
      // while the input is still open.
      if (searchingRef.current) {
        if (key.escape) {
          setSearching(false);
          exitSearch();
          return;
        }
        if (key.return) {
          setSearching(false);
          return;
        }
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
          return;
        }
        const isNavKey =
          key.upArrow ||
          key.downArrow ||
          key.leftArrow ||
          key.rightArrow ||
          key.pageUp ||
          key.pageDown ||
          key.tab;
        if (!isNavKey && input && !key.ctrl && !key.meta) {
          // Flip to search mode on the first keystroke so the sidebar
          // header updates immediately and the debounced effect runs.
          if (modeRef.current !== "search") setMode("search");
          setSearchQuery((q) => q + input);
          return;
        }
        if (!isNavKey) return;
        // fall through to handleListDetailKey for nav keys
      }

      if (input !== "d") deleteConfirm.cancel();

      // Esc in search-results mode returns to the tree view.
      if (key.escape && modeRef.current === "search") {
        exitSearch();
        return;
      }

      if (
        handleListDetailKey(input, key, {
          focusRef,
          setFocus,
          itemCountRef,
          maxDetailScrollRef,
          setSelectedIndex,
          setDetailScroll,
          pageScrollLines: PAGE_SCROLL_LINES,
          onRightArrow: () => {
            if (focusRef.current !== "list") return false;
            const row = selectedRowRef.current;
            if (row?.kind === "dir") {
              drillIn(row.full_path);
              return true;
            }
            return false;
          },
          onLeftArrow: () => {
            if (focusRef.current !== "list") return false;
            if (modeRef.current === "search") {
              exitSearch();
              return true;
            }
            return popPrefix();
          },
        })
      ) {
        return;
      }

      if (input === "d") {
        const row = selectedRowRef.current;
        if (!row) return;
        const label =
          row.kind === "dir"
            ? `${row.full_path}/ (${row.child_count} items)`
            : row.kind === "file"
              ? row.entry.logical_path
              : row.hit.logical_path;
        deleteConfirm.pressDelete(label);
        return;
      }
      if (key.ctrl && (input === "r" || input === "R")) {
        refresh();
        return;
      }
      if (input === "/" || input === "s") {
        setSearching(true);
        setSearchQuery("");
        setSearchError(null);
        return;
      }
    },
    { isActive },
  );

  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleDetailRows,
  );

  const sidebarHeader =
    mode === "search"
      ? `🔍 "${searchQuery || "(empty)"}" (${searchResults.length})`
      : `membot · /${currentPrefix} (${rows.length})`;

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
            {sidebarHeader}
          </Text>
        </Box>
        {searching && (
          <Box paddingX={1}>
            <Text color={theme.info}>🔍 </Text>
            <Text color={theme.info}>{searchQuery}</Text>
            <Text color={theme.info}>▌</Text>
          </Box>
        )}
        {rows.length === 0 ? (
          <Box paddingX={1}>
            <Text dimColor>
              {mode === "search"
                ? searchRunning
                  ? "(searching…)"
                  : searchError
                    ? `(error: ${searchError})`
                    : "(no hits — Esc to return)"
                : currentPrefix
                  ? "(empty — ← to go back)"
                  : "(empty — try `botholomew membot add …`)"}
            </Text>
          </Box>
        ) : (
          visibleItems.map((row, vi) => {
            const i = vi + sidebarScrollOffset;
            const isSelected = i === selectedIndex;
            const label = renderRowLabel(row);
            const key =
              row.kind === "dir"
                ? `d:${row.full_path}`
                : row.kind === "file"
                  ? `f:${row.entry.logical_path}`
                  : `h:${row.hit.logical_path}:${row.hit.chunk_index}`;
            return (
              <Box key={key} paddingX={1}>
                <Text
                  backgroundColor={isSelected ? theme.selectionBg : undefined}
                  color={isSelected ? theme.info : undefined}
                  bold={isSelected}
                  wrap="truncate-end"
                >
                  {isSelected ? "▸" : " "} {label}
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
        {selectedRow ? (
          <>
            <ContextDetailHeader row={selectedRow} />
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
              : mode === "search"
                ? "↑↓ select · → detail · Esc/← back to tree · d delete (×2) · / new search"
                : currentPrefix
                  ? "↑↓ select · → drill/detail · ← up · / search · d delete (×2) · ^R refresh"
                  : "↑↓ select · → drill/detail · / search · d delete (×2) · ^R refresh"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});

function renderRowLabel(row: SidebarRow): string {
  if (row.kind === "dir") {
    return `📁 ${row.name}/`;
  }
  if (row.kind === "file") {
    return `📄 ${lastSegment(row.entry.logical_path)}`;
  }
  // search hit: show path + score
  return `${row.hit.score.toFixed(2)} ${row.hit.logical_path}`;
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ContextDetailHeader({ row }: { row: SidebarRow }) {
  if (row.kind === "dir") {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text
            bold
            color="cyan"
            backgroundColor={theme.headerBg}
            wrap="truncate-end"
          >
            📁 {row.full_path}/
          </Text>
        </Box>
        <Box>
          <Text dimColor backgroundColor={theme.headerBg} wrap="truncate-end">
            directory · {row.child_count} item
            {row.child_count === 1 ? "" : "s"}
          </Text>
        </Box>
      </Box>
    );
  }
  if (row.kind === "file") {
    const entry = row.entry;
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text
            bold
            color="cyan"
            backgroundColor={theme.headerBg}
            wrap="truncate-end"
          >
            📄 {entry.logical_path}
          </Text>
        </Box>
        <Box>
          <Text dimColor backgroundColor={theme.headerBg} wrap="truncate-end">
            {entry.mime_type ?? "?"} · {formatSize(entry.size_bytes)} · v=
            {entry.version_id}
          </Text>
        </Box>
        {entry.description ? (
          <Box>
            <Text dimColor backgroundColor={theme.headerBg} wrap="truncate-end">
              {entry.description}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }
  const hit = row.hit;
  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text
          bold
          color="cyan"
          backgroundColor={theme.headerBg}
          wrap="truncate-end"
        >
          📄 {hit.logical_path}
        </Text>
      </Box>
      <Box>
        <Text dimColor backgroundColor={theme.headerBg} wrap="truncate-end">
          hit · score={hit.score.toFixed(3)} · chunk #{hit.chunk_index} · v=
          {hit.version_id}
        </Text>
      </Box>
    </Box>
  );
}
