import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { DbConnection } from "../../db/connection.ts";
import {
  type ContextItem,
  getDistinctDirectories,
  listContextItemsByPrefix,
  searchContextByKeyword,
} from "../../db/context.ts";

interface ContextPanelProps {
  conn: DbConnection;
  isActive: boolean;
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

type Entry = DirEntry | FileEntry;

export function ContextPanel({ conn, isActive }: ContextPanelProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<ContextItem | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ContextItem[] | null>(
    null,
  );

  const loadEntries = useCallback(
    async (path: string) => {
      const dirs = await getDistinctDirectories(conn, path);
      const files = await listContextItemsByPrefix(conn, path, {
        recursive: false,
      });

      const dirEntries: DirEntry[] = dirs.map((d) => ({
        type: "directory",
        name: d,
        path: `${d}/`,
      }));

      // Files are items directly under this path (not in subdirectories)
      const fileEntries: FileEntry[] = files
        .filter((f) => !dirs.some((d) => f.context_path.startsWith(`${d}/`)))
        .map((f) => ({ type: "file", item: f }));

      setEntries([...dirEntries, ...fileEntries]);
      setCursor(0);
      setPreview(null);
    },
    [conn],
  );

  useEffect(() => {
    if (searchResults === null) {
      loadEntries(currentPath);
    }
  }, [currentPath, loadEntries, searchResults]);

  const executeSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults(null);
        return;
      }
      const results = await searchContextByKeyword(conn, query.trim(), 50);
      setSearchResults(results);
      setCursor(0);
      setPreview(null);
    },
    [conn],
  );

  useInput(
    (input, key) => {
      // Search mode: capture text input
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

      // Normal navigation
      if (input === "/") {
        setSearchMode(true);
        setSearchQuery("");
        return;
      }

      if (key.escape) {
        if (searchResults !== null) {
          setSearchResults(null);
          setPreview(null);
          return;
        }
        if (preview) {
          setPreview(null);
          return;
        }
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        setPreview(null);
        return;
      }
      if (key.downArrow) {
        if (searchResults !== null) {
          setCursor((c) => Math.min(searchResults.length - 1, c + 1));
        } else {
          setCursor((c) => Math.min(entries.length - 1, c + 1));
        }
        setPreview(null);
        return;
      }

      if (key.return) {
        if (searchResults !== null) {
          const item = searchResults[cursor];
          if (item) setPreview(item);
          return;
        }
        const entry = entries[cursor];
        if (!entry) return;
        if (entry.type === "directory") {
          setCurrentPath(entry.path);
        } else {
          setPreview(entry.item);
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (currentPath !== "/") {
          const parts = currentPath.replace(/\/$/, "").split("/");
          parts.pop();
          const parent = parts.length <= 1 ? "/" : `${parts.join("/")}/`;
          setCurrentPath(parent);
        }
      }
    },
    { isActive },
  );

  // Render search results view
  if (searchResults !== null) {
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
          {searchResults.map((item, i) => (
            <Box key={item.id}>
              <Text
                backgroundColor={i === cursor ? "#333" : undefined}
                color={i === cursor ? "cyan" : undefined}
              >
                {"  "}📄 {item.context_path}
                <Text dimColor> ({item.mime_type})</Text>
              </Text>
            </Box>
          ))}
        </Box>
        {preview && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            height={10}
          >
            <Text bold color="cyan">
              {preview.context_path}
            </Text>
            <Text dimColor>
              {preview.mime_type} · {preview.is_textual ? "text" : "binary"} ·{" "}
              {preview.indexed_at ? "indexed" : "not indexed"}
            </Text>
            <Text>
              {preview.content ? preview.content.slice(0, 500) : "(no content)"}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Render file preview
  if (preview) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box>
          <Text bold color="cyan">
            {preview.context_path}
          </Text>
          <Text dimColor> (esc to go back)</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            Type: {preview.mime_type} · Title: {preview.title}
            {preview.description ? ` · ${preview.description}` : ""}
          </Text>
          <Text dimColor>
            Source: {preview.source_path ?? "n/a"} ·{" "}
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
          <Text>
            {preview.content ? preview.content : "(binary or empty content)"}
          </Text>
        </Box>
      </Box>
    );
  }

  // Render directory listing
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box>
        <Text bold color="cyan">
          {currentPath}
        </Text>
        <Text dimColor>
          {" "}
          ({entries.length} items · / to search · backspace to go up)
        </Text>
      </Box>
      {searchMode && (
        <Box marginTop={1}>
          <Text color="green">search: </Text>
          <Text>{searchQuery}</Text>
          <Text dimColor>█</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {entries.length === 0 && <Text dimColor>No context items found</Text>}
        {entries.map((entry, i) => {
          const isSelected = i === cursor;
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
    </Box>
  );
}
