import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

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
  // historyIndex: -1 means "not browsing history" (current input shown)
  // 0 = most recent, 1 = second most recent, etc.
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedInput = useRef("");

  const handleChange = useCallback(
    (newValue: string) => {
      // If user types while browsing history, exit history mode
      if (historyIndex !== -1) {
        setHistoryIndex(-1);
      }
      onChange(newValue);
    },
    [historyIndex, onChange],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      setHistoryIndex(-1);
      savedInput.current = "";
      onSubmit(text);
    },
    [onSubmit],
  );

  useInput(
    (_input, key) => {
      if (disabled || history.length === 0) return;

      if (key.upArrow) {
        const nextIndex = historyIndex + 1;
        if (nextIndex < history.length) {
          if (historyIndex === -1) {
            savedInput.current = value;
          }
          setHistoryIndex(nextIndex);
          const entry = history[history.length - 1 - nextIndex];
          if (entry !== undefined) onChange(entry);
        }
      } else if (key.downArrow) {
        if (historyIndex > 0) {
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          const entry = history[history.length - 1 - nextIndex];
          if (entry !== undefined) onChange(entry);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          onChange(savedInput.current);
        }
      }
    },
    { isActive: !disabled },
  );

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
      <Box>
        <Text color={disabled ? "gray" : "green"}>{"❯ "}</Text>
        {disabled ? (
          <Text dimColor>{value || "..."}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="Type a message..."
          />
        )}
      </Box>
    </Box>
  );
}
