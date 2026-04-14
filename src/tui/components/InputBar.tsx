import { Box, Text, useInput } from "ink";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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
  const [cursorPos, setCursorPos] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const savedInput = useRef("");
  const lastActivity = useRef(Date.now());

  // Blink cursor when input is active
  useEffect(() => {
    if (disabled) {
      setCursorVisible(true);
      return;
    }
    const id = setInterval(() => {
      const elapsed = Date.now() - lastActivity.current;
      const phase = Math.floor(elapsed / 530) % 2 === 0;
      setCursorVisible(phase);
    }, 530);
    return () => clearInterval(id);
  }, [disabled]);

  useInput(
    (input, key) => {
      if (disabled) return;
      lastActivity.current = Date.now();
      setCursorVisible(true);

      // Enter: submit (shift+enter or opt+enter inserts newline)
      if (key.return) {
        if (key.shift || key.meta) {
          const before = value.slice(0, cursorPos);
          const after = value.slice(cursorPos);
          onChange(`${before}\n${after}`);
          setCursorPos(cursorPos + 1);
        } else {
          setHistoryIndex(-1);
          savedInput.current = "";
          setCursorPos(0);
          onSubmit(value);
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          const before = value.slice(0, cursorPos - 1);
          const after = value.slice(cursorPos);
          onChange(before + after);
          setCursorPos(cursorPos - 1);
        }
        return;
      }

      // Left/right arrow for cursor movement
      if (key.leftArrow) {
        setCursorPos((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorPos((c) => Math.min(value.length, c + 1));
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
          if (entry !== undefined) {
            onChange(entry);
            setCursorPos(entry.length);
          }
        }
        return;
      }

      if (key.downArrow && history.length > 0) {
        if (historyIndex > 0) {
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          const entry = history[history.length - 1 - nextIndex];
          if (entry !== undefined) {
            onChange(entry);
            setCursorPos(entry.length);
          }
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          onChange(savedInput.current);
          setCursorPos(savedInput.current.length);
        }
        return;
      }

      // Ignore other control keys
      if (key.ctrl || key.escape || key.tab) {
        return;
      }

      // Regular character input
      if (input) {
        if (historyIndex !== -1) {
          setHistoryIndex(-1);
        }
        const before = value.slice(0, cursorPos);
        const after = value.slice(cursorPos);
        onChange(before + input + after);
        setCursorPos(cursorPos + input.length);
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
      {header}
      <Box flexDirection="column">
        <Box>
          <Text color={disabled ? "gray" : "green"}>{"› "}</Text>
          {placeholder ? (
            <Text dimColor>Type a message...</Text>
          ) : (
            <Text>
              {value.slice(0, cursorPos)}
              <Text inverse={cursorVisible}>{value[cursorPos] ?? " "}</Text>
              {value.slice(cursorPos + 1)}
            </Text>
          )}
        </Box>
        {isMultiline && (
          <Box>
            <Text dimColor> alt+return for newline, return to send</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
