import { Box, Text, useInput } from "ink";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SlashCommand } from "../../skills/commands.ts";
import { getSlashMatches, shouldSubmitOnEnter } from "../slashCompletion.ts";
import { SlashCommandPopup } from "./SlashCommandPopup.tsx";

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
  history: string[];
  header?: ReactNode;
  slashCommands?: SlashCommand[];
}

export const InputBar = memo(function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  history,
  header,
  slashCommands,
}: InputBarProps) {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cursorPos, setCursorPos] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [popupDismissed, setPopupDismissed] = useState(false);
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
  const slashCommandsRef = useRef(slashCommands);
  const selectedIndexRef = useRef(selectedIndex);
  const popupDismissedRef = useRef(popupDismissed);

  valueRef.current = value;
  cursorPosRef.current = cursorPos;
  historyIndexRef.current = historyIndex;
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  historyRef.current = history;
  slashCommandsRef.current = slashCommands;
  selectedIndexRef.current = selectedIndex;
  popupDismissedRef.current = popupDismissed;

  // Matches visible in the autocomplete popup, or null when it should be
  // hidden (non-slash input, space typed, no matches, or user escaped).
  const popupMatches = useMemo(() => {
    if (popupDismissed) return null;
    return getSlashMatches(value, slashCommands ?? []);
  }, [value, slashCommands, popupDismissed]);

  // Reset highlight to top whenever the match list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on match-list change, not value change
  useEffect(() => {
    setSelectedIndex(0);
  }, [popupMatches?.length]);

  // Clamp highlight if the list shrank (defensive — the effect above usually handles it).
  useEffect(() => {
    if (popupMatches && selectedIndex >= popupMatches.length) {
      setSelectedIndex(Math.max(0, popupMatches.length - 1));
    }
  }, [popupMatches, selectedIndex]);

  // Clear the dismissed flag as soon as the user edits the value,
  // so a fresh "/" reopens the popup.
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value && popupDismissed) {
      setPopupDismissed(false);
    }
    prevValueRef.current = value;
  }, [value, popupDismissed]);

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

      // Is the slash popup visible right now? Recompute from the authoritative
      // ref-state so we don't depend on stale closure values.
      const popupOpen = !popupDismissedRef.current
        ? getSlashMatches(val, slashCommandsRef.current ?? [])
        : null;

      const acceptSelection = (mode: "insert" | "submit") => {
        if (!popupOpen) return false;
        const chosen =
          popupOpen[Math.min(selectedIndexRef.current, popupOpen.length - 1)];
        if (!chosen) return false;
        if (mode === "submit") {
          const completed = `/${chosen.name}`;
          valueRef.current = completed;
          cursorPosRef.current = 0;
          onChangeRef.current(completed);
          setCursorPos(0);
          historyIndexRef.current = -1;
          setHistoryIndex(-1);
          savedInput.current = "";
          onSubmitRef.current(completed);
          return true;
        }
        const completed = `/${chosen.name} `;
        valueRef.current = completed;
        cursorPosRef.current = completed.length;
        onChangeRef.current(completed);
        setCursorPos(completed.length);
        // A trailing space makes the popup disappear naturally via regex,
        // but set dismissed too so stray state can't re-open it.
        setPopupDismissed(true);
        return true;
      };

      // Escape: close popup if open, keep value untouched
      if (key.escape) {
        if (popupOpen) {
          setPopupDismissed(true);
        }
        return;
      }

      // Enter: if popup is open, accept the highlighted entry. No-arg
      // commands submit in one keystroke; commands that take args insert
      // `/<name> ` and wait for the user to finish typing.
      if (key.return) {
        if (popupOpen && !key.shift && !key.meta) {
          const chosen =
            popupOpen[Math.min(selectedIndexRef.current, popupOpen.length - 1)];
          acceptSelection(
            chosen && shouldSubmitOnEnter(chosen) ? "submit" : "insert",
          );
          return;
        }
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

      // Tab: insert the highlighted completion so the user can keep editing.
      if (key.tab) {
        if (popupOpen) {
          acceptSelection("insert");
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

      // Up/Down: popup navigation when open, history otherwise
      if (key.upArrow) {
        if (popupOpen) {
          const next = Math.max(0, selectedIndexRef.current - 1);
          selectedIndexRef.current = next;
          setSelectedIndex(next);
          return;
        }
        if (hist.length > 0) {
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
        }
        return;
      }

      if (key.downArrow) {
        if (popupOpen) {
          const next = Math.min(
            popupOpen.length - 1,
            selectedIndexRef.current + 1,
          );
          selectedIndexRef.current = next;
          setSelectedIndex(next);
          return;
        }
        if (hist.length > 0) {
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
        }
        return;
      }

      // Ignore other control keys
      if (key.ctrl) {
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
  const showPopup = !disabled && popupMatches !== null;

  return (
    <Box flexDirection="column">
      {showPopup && popupMatches && (
        <SlashCommandPopup
          matches={popupMatches}
          selectedIndex={selectedIndex}
        />
      )}
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
    </Box>
  );
});
