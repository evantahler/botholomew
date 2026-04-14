import { Box, Text, useInput } from "ink";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
  history: string[];
  header?: ReactNode;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  history,
  header,
}: InputBarProps) {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedInput = useRef("");

  useInput(
    (input, key) => {
      if (disabled) return;

      // Enter: submit (shift+enter or opt+enter inserts newline)
      if (key.return) {
        if (key.shift || key.meta) {
          onChange(`${value}\n`);
        } else {
          setHistoryIndex(-1);
          savedInput.current = "";
          onSubmit(value);
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (value.length > 0) {
          onChange(value.slice(0, -1));
        }
        return;
      }

      // History navigation
      if (key.upArrow && history.length > 0) {
        const nextIndex = historyIndex + 1;
        if (nextIndex < history.length) {
          if (historyIndex === -1) {
            savedInput.current = value;
          }
          setHistoryIndex(nextIndex);
          const entry = history[history.length - 1 - nextIndex];
          if (entry !== undefined) onChange(entry);
        }
        return;
      }

      if (key.downArrow && history.length > 0) {
        if (historyIndex > 0) {
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          const entry = history[history.length - 1 - nextIndex];
          if (entry !== undefined) onChange(entry);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          onChange(savedInput.current);
        }
        return;
      }

      // Ignore other control keys
      if (
        key.ctrl ||
        key.escape ||
        key.leftArrow ||
        key.rightArrow ||
        key.tab
      ) {
        return;
      }

      // Regular character input
      if (input) {
        if (historyIndex !== -1) {
          setHistoryIndex(-1);
        }
        onChange(`${value}${input}`);
      }
    },
    { isActive: !disabled },
  );

  const isMultiline = value.includes("\n");
  const placeholder = !value && !disabled;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={disabled ? "gray" : "green"}
      paddingX={1}
    >
      {header && (
        <Box borderBottom borderColor="gray" paddingBottom={0} marginBottom={0}>
          {header}
        </Box>
      )}
      <Box flexDirection="column">
        <Box>
          <Text color={disabled ? "gray" : "green"}>{"❯ "}</Text>
          {placeholder ? (
            <Text dimColor>Type a message...</Text>
          ) : (
            <Text>{value}</Text>
          )}
        </Box>
        {isMultiline && (
          <Box>
            <Text dimColor> ⌥+return for newline · return to send</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
