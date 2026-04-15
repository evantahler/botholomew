import { Box, Text, useInput } from "ink";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
  history: string[];
  header?: ReactNode;
}

export const InputBar = memo(function InputBar({
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

  // Refs for values read inside the input handler — eagerly updated so rapid
  // keystrokes that arrive before React re-renders always see fresh state.
  const valueRef = useRef(value);
  const cursorPosRef = useRef(cursorPos);
  const historyIndexRef = useRef(historyIndex);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const historyRef = useRef(history);

  valueRef.current = value;
  cursorPosRef.current = cursorPos;
  historyIndexRef.current = historyIndex;
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  historyRef.current = history;

  // Blink cursor when input is active — skip ticks while typing so the
  // cursor stays solid and we avoid unnecessary renders during rapid input.
  useEffect(() => {
    if (disabled) {
      setCursorVisible(true);
      return;
    }
    const id = setInterval(() => {
      const elapsed = Date.now() - lastActivity.current;
      if (elapsed < 530) return; // still typing — keep cursor solid
      const phase = Math.floor(elapsed / 530) % 2 === 0;
      setCursorVisible((prev) => (prev === phase ? prev : phase));
    }, 530);
    return () => clearInterval(id);
  }, [disabled]);

  // Stable input handler — the callback reference never changes, which
  // prevents Ink's useInput from removing/re-adding the stdin listener on
  // every render. Without this, rapid typing causes listener churn that
  // overwhelms the event loop and pegs the CPU at 100%.
  const stableHandler = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: Ink's Key type is not exported
    (input: string, key: any) => {
      if (disabled) return;
      lastActivity.current = Date.now();

      const val = valueRef.current;
      const pos = cursorPosRef.current;
      const hIdx = historyIndexRef.current;
      const hist = historyRef.current;

      // Enter: submit (shift+enter or opt+enter inserts newline)
      if (key.return) {
        if (key.shift || key.meta) {
          const before = val.slice(0, pos);
          const after = val.slice(pos);
          const newVal = `${before}\n${after}`;
          const newPos = pos + 1;
          valueRef.current = newVal;
          cursorPosRef.current = newPos;
          onChangeRef.current(newVal);
          setCursorPos(newPos);
        } else {
          historyIndexRef.current = -1;
          setHistoryIndex(-1);
          savedInput.current = "";
          cursorPosRef.current = 0;
          setCursorPos(0);
          onSubmitRef.current(val);
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (pos > 0) {
          const before = val.slice(0, pos - 1);
          const after = val.slice(pos);
          const newVal = before + after;
          const newPos = pos - 1;
          valueRef.current = newVal;
          cursorPosRef.current = newPos;
          onChangeRef.current(newVal);
          setCursorPos(newPos);
        }
        return;
      }

      // Left/right arrow for cursor movement
      if (key.leftArrow) {
        const newPos = Math.max(0, pos - 1);
        cursorPosRef.current = newPos;
        setCursorPos(newPos);
        return;
      }
      if (key.rightArrow) {
        const newPos = Math.min(val.length, pos + 1);
        cursorPosRef.current = newPos;
        setCursorPos(newPos);
        return;
      }

      // History navigation
      if (key.upArrow && hist.length > 0) {
        const nextIndex = hIdx + 1;
        if (nextIndex < hist.length) {
          if (hIdx === -1) {
            savedInput.current = val;
          }
          historyIndexRef.current = nextIndex;
          setHistoryIndex(nextIndex);
          const entry = hist[hist.length - 1 - nextIndex];
          if (entry !== undefined) {
            valueRef.current = entry;
            cursorPosRef.current = entry.length;
            onChangeRef.current(entry);
            setCursorPos(entry.length);
          }
        }
        return;
      }

      if (key.downArrow && hist.length > 0) {
        if (hIdx > 0) {
          const nextIndex = hIdx - 1;
          historyIndexRef.current = nextIndex;
          setHistoryIndex(nextIndex);
          const entry = hist[hist.length - 1 - nextIndex];
          if (entry !== undefined) {
            valueRef.current = entry;
            cursorPosRef.current = entry.length;
            onChangeRef.current(entry);
            setCursorPos(entry.length);
          }
        } else if (hIdx === 0) {
          historyIndexRef.current = -1;
          setHistoryIndex(-1);
          const saved = savedInput.current;
          valueRef.current = saved;
          cursorPosRef.current = saved.length;
          onChangeRef.current(saved);
          setCursorPos(saved.length);
        }
        return;
      }

      // Ignore other control keys
      if (key.ctrl || key.escape || key.tab) {
        return;
      }

      // Regular character input
      if (input) {
        if (hIdx !== -1) {
          historyIndexRef.current = -1;
          setHistoryIndex(-1);
        }
        const before = val.slice(0, pos);
        const after = val.slice(pos);
        const newVal = before + input + after;
        const newPos = pos + input.length;
        valueRef.current = newVal;
        cursorPosRef.current = newPos;
        onChangeRef.current(newVal);
        setCursorPos(newPos);
      }
    },
    [disabled],
  );

  useInput(stableHandler, { isActive: !disabled });

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
      {!disabled && (
        <Box flexDirection="column">
          <Box>
            <Text color="green">{"› "}</Text>
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
      )}
    </Box>
  );
});
