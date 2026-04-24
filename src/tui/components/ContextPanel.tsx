import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { formatDriveRef } from "../../context/drives.ts";
import { withDb } from "../../db/connection.ts";
import {
  type ContextItem,
  deleteContextItem,
  deleteContextItemsByPrefix,
  getDistinctDirectories,
  listContextItemsByPrefix,
  listDriveSummaries,
  searchContextByKeyword,
} from "../../db/context.ts";
import { isMarkdownItem, renderMarkdown } from "../markdown.ts";

interface ContextPanelProps {
  dbPath: string;
  isActive: boolean;
}

interface DriveEntry {
  type: "drive";
  drive: string;
  count: number;
}

interface DirEntry {
  type: "directory";
  name: string;
  path: string;
}

interface FileEntry {
  type: "file";
  item: ContextItem;
}

type Entry = DriveEntry | DirEntry | FileEntry;

const CHROME_LINES = 8;

export const ContextPanel = memo(function ContextPanel({
  dbPath,
  isActive,
}: ContextPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  // currentDrive === null means we're at the "pick a drive" level.
  const [currentDrive, setCurrentDrive] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [preview, setPreview] = useState<ContextItem | null>(null);
  const [previewScroll, setPreviewScroll] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ContextItem[] | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const visibleRows = Math.max(1, termRows - CHROME_LINES);

  useEffect(() => {
    if (cursor < scrollOffset) {
      setScrollOffset(cursor);
    } else if (cursor >= scrollOffset + visibleRows) {
      setScrollOffset(cursor - visibleRows + 1);
    }
  }, [cursor, scrollOffset, visibleRows]);

  const loadEntries = useCallback(
    async (drive: string | null, path: string) => {
      if (drive === null) {
        const summaries = await withDb(dbPath, (conn) =>
          listDriveSummaries(conn),
        );
        const driveEntries: DriveEntry[] = summaries.map((s) => ({
          type: "drive",
          drive: s.drive,
          count: s.count,
        }));
        setEntries(driveEntries);
        setCursor(0);
        setScrollOffset(0);
        setPreview(null);
        return;
      }

      const [dirs, files] = await withDb(dbPath, async (conn) => [
        await getDistinctDirectories(conn, drive, path),
        await listContextItemsByPrefix(conn, drive, path, { recursive: false }),
      ]);

      const dirEntries: DirEntry[] = dirs.map((d) => ({
        type: "directory",
        name: d,
        path: `${d}/`,
      }));

      const fileEntries: FileEntry[] = files
        .filter((f) => !dirs.some((d) => f.path.startsWith(`${d}/`)))
        .map((f) => ({ type: "file", item: f }));

      setEntries([...dirEntries, ...fileEntries]);
      setCursor(0);
      setScrollOffset(0);
      setPreview(null);
    },
    [dbPath],
  );

  useEffect(() => {
    if (searchResults === null) {
      loadEntries(currentDrive, currentPath);
    }
  }, [currentDrive, currentPath, loadEntries, searchResults]);

  const executeSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults(null);
        return;
      }
      const results = await withDb(dbPath, (conn) =>
        searchContextByKeyword(conn, query.trim(), 50),
      );
      setSearchResults(results);
      setCursor(0);
      setScrollOffset(0);
      setPreview(null);
    },
    [dbPath],
  );

  const items = searchResults ?? entries;
  const itemCount = items.length;
  const visibleItems = useMemo(
    () => items.slice(scrollOffset, scrollOffset + visibleRows),
    [items, scrollOffset, visibleRows],
  );

  const previewLines = useMemo(() => {
    if (!preview?.content) return [];
    const body = isMarkdownItem(preview)
      ? renderMarkdown(preview.content)
      : preview.content;
    return body.split("\n");
  }, [preview]);

  useInput(
    (input, key) => {
      if (searchMode) {
        if (key.return) {
          setSearchMode(false);
          executeSearch(searchQuery);
          return;
        }
        if (key.escape) {
          setSearchMode(false);
          setSearchQuery("");
          setSearchResults(null);
          return;
        }
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setSearchQuery((q) => q + input);
        }
        return;
      }

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
        if (key.escape) {
          setPreview(null);
          setPreviewScroll(0);
          return;
        }
        return;
      }

      if (confirmDelete) {
        if (input === "y" || input === "d") {
          const entry = entries[cursor];
          if (entry) {
            void withDb(dbPath, async (conn) => {
              if (entry.type === "directory" && currentDrive) {
                await deleteContextItemsByPrefix(
                  conn,
                  currentDrive,
                  entry.path,
                );
              } else if (entry.type === "file") {
                await deleteContextItem(conn, entry.item.id);
              }
            });
            setConfirmDelete(false);
            loadEntries(currentDrive, currentPath);
          }
        } else {
          setConfirmDelete(false);
        }
        return;
      }

      if (input === "d" && itemCount > 0 && searchResults === null) {
        setConfirmDelete(true);
        return;
      }

      if (input === "/") {
        setSearchMode(true);
        setSearchQuery("");
        return;
      }

      if (key.escape) {
        if (searchResults !== null) {
          setSearchResults(null);
          setPreview(null);
          setScrollOffset(0);
          return;
        }
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
        if (searchResults !== null) {
          const item = searchResults[cursor];
          if (item) {
            setPreview(item);
            setPreviewScroll(0);
          }
          return;
        }
        const entry = entries[cursor];
        if (!entry) return;
        if (entry.type === "drive") {
          setCurrentDrive(entry.drive);
          setCurrentPath("/");
        } else if (entry.type === "directory") {
          setCurrentPath(entry.path);
        } else {
          setPreview(entry.item);
          setPreviewScroll(0);
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (currentPath !== "/") {
          const parts = currentPath.replace(/\/$/, "").split("/");
          parts.pop();
          const parent = parts.length <= 1 ? "/" : `${parts.join("/")}/`;
          setCurrentPath(parent);
        } else if (currentDrive !== null) {
          setCurrentDrive(null);
        }
      }
    },
    { isActive },
  );

  if (searchResults !== null && !preview) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box>
          <Text bold color="cyan">
            Search results for: &quot;{searchQuery}&quot;
          </Text>
          <Text dimColor> ({searchResults.length} matches · esc to clear)</Text>
        </Box>
        <Box flexDirection="column" marginTop={1} flexGrow={1}>
          {searchResults.length === 0 && <Text dimColor>No results found</Text>}
          {visibleItems.map((item, vi) => {
            const i = vi + scrollOffset;
            const ci = item as ContextItem;
            const ref = formatDriveRef(ci);
            return (
              <Box key={ci.id}>
                <Text
                  backgroundColor={i === cursor ? "#333" : undefined}
                  color={i === cursor ? "cyan" : undefined}
                >
                  {"  "}📄 <Text dimColor>{ref}</Text> — {ci.title}
                  <Text dimColor> ({ci.mime_type})</Text>
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
  }

  if (preview) {
    const visiblePreviewLines = previewLines.slice(
      previewScroll,
      previewScroll + visibleRows - 2,
    );
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box>
          <Text bold color="cyan">
            {formatDriveRef(preview)}
          </Text>
          <Text dimColor> (esc to go back · ↑↓ to scroll)</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            Type: {preview.mime_type} · Title: {preview.title}
            {preview.description ? ` · ${preview.description}` : ""}
          </Text>
          <Text dimColor>
            {preview.indexed_at ? "Indexed" : "Not indexed"} · Updated:{" "}
            {preview.updated_at.toLocaleDateString()}
          </Text>
        </Box>
        <Box
          marginTop={1}
          flexDirection="column"
          flexGrow={1}
          overflow="hidden"
        >
          {preview.content ? (
            visiblePreviewLines.map((line, i) => {
              const lineNum = previewScroll + i;
              return <Text key={lineNum}>{line || " "}</Text>;
            })
          ) : (
            <Text dimColor>(binary or empty content)</Text>
          )}
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
    currentDrive === null
      ? "(drives)"
      : formatDriveRef({ drive: currentDrive, path: currentPath });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box>
        <Text bold color="cyan">
          {headerLabel}
        </Text>
        <Text dimColor>
          {" "}
          ({entries.length} items · / search · d delete · backspace up)
        </Text>
      </Box>
      {searchMode && (
        <Box marginTop={1}>
          <Text color="green">search: </Text>
          <Text>{searchQuery}</Text>
          <Text dimColor>█</Text>
        </Box>
      )}
      {confirmDelete && entries[cursor] && (
        <Box marginTop={1}>
          <Text color="red" bold>
            Delete{" "}
            {entries[cursor].type === "directory"
              ? `${(entries[cursor] as DirEntry).name}/ and all contents`
              : entries[cursor].type === "file"
                ? (entries[cursor] as FileEntry).item.title
                : "(pick a file first)"}
            ? (y/n)
          </Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {entries.length === 0 && <Text dimColor>No context items found</Text>}
        {visibleItems.map((raw, vi) => {
          const i = vi + scrollOffset;
          const entry = raw as Entry;
          const isSelected = i === cursor;
          if (entry.type === "drive") {
            return (
              <Box key={entry.drive}>
                <Text
                  backgroundColor={isSelected ? "#333" : undefined}
                  color={isSelected ? "cyan" : "magenta"}
                  bold={isSelected}
                >
                  {"  "}🗄 {entry.drive}:/ <Text dimColor>({entry.count})</Text>
                </Text>
              </Box>
            );
          }
          if (entry.type === "directory") {
            return (
              <Box key={entry.path}>
                <Text
                  backgroundColor={isSelected ? "#333" : undefined}
                  color={isSelected ? "cyan" : "blue"}
                  bold={isSelected}
                >
                  {"  "}📁 {entry.name}/
                </Text>
              </Box>
            );
          }
          return (
            <Box key={entry.item.id}>
              <Text
                backgroundColor={isSelected ? "#333" : undefined}
                color={isSelected ? "cyan" : undefined}
              >
                {"  "}📄 {entry.item.title}
                <Text dimColor> ({entry.item.mime_type})</Text>
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
