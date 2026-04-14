import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { theme } from "../theme.ts";
import type { ToolCallData } from "./ToolCall.tsx";

interface ToolPanelProps {
  toolCalls: ToolCallData[];
  isActive: boolean;
}

/** A flattened row in the JSON tree */
interface TreeRow {
  depth: number;
  key: string;
  value: string | null; // null = expandable parent
  path: string;
  hasChildren: boolean;
}

function flattenJson(
  obj: unknown,
  parentPath: string,
  depth: number,
  expanded: Set<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];

  if (obj === null || obj === undefined) {
    return rows;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const path = `${parentPath}[${i}]`;
      const child = obj[i];
      if (typeof child === "object" && child !== null) {
        rows.push({
          depth,
          key: `[${i}]`,
          value: expanded.has(path) ? null : `[…]`,
          path,
          hasChildren: true,
        });
        if (expanded.has(path)) {
          rows.push(...flattenJson(child, path, depth + 1, expanded));
        }
      } else {
        rows.push({
          depth,
          key: `[${i}]`,
          value: formatValue(child),
          path,
          hasChildren: false,
        });
      }
    }
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = parentPath ? `${parentPath}.${k}` : k;
      if (typeof v === "object" && v !== null) {
        const childCount = Array.isArray(v) ? v.length : Object.keys(v).length;
        const preview = Array.isArray(v)
          ? `[${childCount} items]`
          : `{${childCount} keys}`;
        rows.push({
          depth,
          key: k,
          value: expanded.has(path) ? null : preview,
          path,
          hasChildren: true,
        });
        if (expanded.has(path)) {
          rows.push(...flattenJson(v, path, depth + 1, expanded));
        }
      } else {
        rows.push({
          depth,
          key: k,
          value: formatValue(v),
          path,
          hasChildren: false,
        });
      }
    }
  }

  return rows;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    if (v.length > 80) return `"${v.slice(0, 77)}…"`;
    return `"${v}"`;
  }
  return String(v);
}

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

type PanelTab = "input" | "output";

export function ToolPanel({ toolCalls, isActive }: ToolPanelProps) {
  const [selectedTool, setSelectedTool] = useState(0);
  const [tab, setTab] = useState<PanelTab>("input");
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tool = toolCalls[selectedTool];

  const data = useMemo(() => {
    if (!tool) return null;
    return tab === "input"
      ? safeParseJson(tool.input)
      : safeParseJson(tool.output ?? "");
  }, [tool, tab]);

  const rows = useMemo(() => {
    if (data === null || data === undefined) return [];
    if (typeof data === "string") {
      return data
        .split("\n")
        .filter((l) => l.trim())
        .map(
          (line, i): TreeRow => ({
            depth: 0,
            key: "",
            value: line,
            path: `line-${i}`,
            hasChildren: false,
          }),
        );
    }
    return flattenJson(data, "", 0, expanded);
  }, [data, expanded]);

  useInput(
    (input, key) => {
      // Tab key switches input/output within the panel
      // (global tab switching is handled by App)
      if (key.tab) {
        setTab((t) => (t === "input" ? "output" : "input"));
        setCursor(0);
        setExpanded(new Set());
        return;
      }

      if (key.leftArrow) {
        setSelectedTool((i) => Math.max(0, i - 1));
        setCursor(0);
        setExpanded(new Set());
        return;
      }
      if (key.rightArrow) {
        setSelectedTool((i) => Math.min(toolCalls.length - 1, i + 1));
        setCursor(0);
        setExpanded(new Set());
        return;
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(rows.length - 1, c + 1));
        return;
      }

      if (key.return) {
        const row = rows[cursor];
        if (row?.hasChildren) {
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(row.path)) {
              for (const p of next) {
                if (
                  p === row.path ||
                  p.startsWith(`${row.path}.`) ||
                  p.startsWith(`${row.path}[`)
                ) {
                  next.delete(p);
                }
              }
            } else {
              next.add(row.path);
            }
            return next;
          });
        }
        return;
      }

      if (input === "e") {
        const allPaths = new Set<string>();
        const expandAll = (obj: unknown, parentPath: string) => {
          if (typeof obj === "object" && obj !== null) {
            if (Array.isArray(obj)) {
              for (let i = 0; i < obj.length; i++) {
                const p = `${parentPath}[${i}]`;
                if (typeof obj[i] === "object" && obj[i] !== null) {
                  allPaths.add(p);
                  expandAll(obj[i], p);
                }
              }
            } else {
              for (const [k, v] of Object.entries(obj)) {
                const p = parentPath ? `${parentPath}.${k}` : k;
                if (typeof v === "object" && v !== null) {
                  allPaths.add(p);
                  expandAll(v, p);
                }
              }
            }
          }
        };
        if (data && typeof data === "object") expandAll(data, "");
        setExpanded(allPaths);
        return;
      }

      if (input === "c") {
        setExpanded(new Set());
        setCursor(0);
      }
    },
    { isActive },
  );

  if (!tool) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>
          No tool calls to inspect yet. Tool calls will appear here as the agent
          uses them.
        </Text>
      </Box>
    );
  }

  const hasOutput = Boolean(tool.output);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexGrow={1}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            🔍 Tool Inspector
          </Text>
          <Text dimColor>
            {" "}
            ({selectedTool + 1}/{toolCalls.length})
          </Text>
        </Box>
        <Text dimColor>
          ←→ tools · tab input/output · ↑↓ navigate · enter expand · e/c all
        </Text>
      </Box>

      {/* Tool name */}
      <Box>
        <Text bold color="magenta">
          {tool.name}
        </Text>
        {tool.running && <Text color={theme.accent}> ⟳ running</Text>}
      </Box>

      {/* Tabs */}
      <Box gap={2}>
        <Text
          bold={tab === "input"}
          color={tab === "input" ? "green" : undefined}
          dimColor={tab !== "input"}
        >
          {tab === "input" ? "▸ " : "  "}Input
        </Text>
        <Text
          bold={tab === "output"}
          color={tab === "output" ? "green" : undefined}
          dimColor={tab !== "output" && !hasOutput}
        >
          {tab === "output" ? "▸ " : "  "}Output{!hasOutput ? " (none)" : ""}
        </Text>
      </Box>

      {/* Tree content */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {rows.length === 0 && <Text dimColor> (empty)</Text>}
        {rows.map((row, i) => {
          const isSelected = i === cursor;
          const indent = "  ".repeat(row.depth);
          const arrow = row.hasChildren
            ? expanded.has(row.path)
              ? "▾ "
              : "▸ "
            : "  ";

          return (
            <Box key={row.path}>
              <Text
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                color={isSelected ? "cyan" : undefined}
              >
                {indent}
                {arrow}
                {row.key ? (
                  <>
                    <Text color="blue" bold={isSelected}>
                      {row.key}
                    </Text>
                    {row.value !== null ? `: ${row.value}` : ""}
                  </>
                ) : (
                  (row.value ?? "")
                )}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
