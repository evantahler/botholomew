import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { useIdle } from "../idle.tsx";
import { theme } from "../theme.ts";

const STARTUP_FRAMES = [
  [" {-,-}", " /)_) ", '  " " '],
  [" {-,-}", " /)_) ", '  " " '],
  [" {o,-}", " /)_) ", '  " " '],
  [" {o,o}", " /)_) ", '  " " '],
  [" {^,^}", " /)_) ", '  " " '],
];

const IDLE_FRAMES = [
  [" {o,o}", " /)_) ", '  " " '],
  [" {o,o}", " /)_) ", '  " " '],
  [" {-,-}", " /)_) ", '  " " '],
  [" {o,o}", " /)_) ", '  " " '],
];

const STARTUP_MS = 400;
const IDLE_MS = 2000;

export function AnimatedLogo() {
  const [frameIndex, setFrameIndex] = useState(0);
  const [startupDone, setStartupDone] = useState(false);
  const { isIdle } = useIdle();

  useEffect(() => {
    if (isIdle) return;
    const interval = setInterval(
      () => {
        setFrameIndex((prev) => {
          if (!startupDone) {
            const next = prev + 1;
            if (next >= STARTUP_FRAMES.length) {
              setStartupDone(true);
              return 0;
            }
            return next;
          }
          return (prev + 1) % IDLE_FRAMES.length;
        });
      },
      startupDone ? IDLE_MS : STARTUP_MS,
    );
    return () => clearInterval(interval);
  }, [startupDone, isIdle]);

  const frames = startupDone ? IDLE_FRAMES : STARTUP_FRAMES;
  // biome-ignore lint: frameIndex is always in bounds
  const frame = frames[frameIndex]!;
  const color = isIdle ? "gray" : theme.accent;

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      {frame.map((line) => (
        <Text key={line} color={color}>
          {line}
        </Text>
      ))}
      <Text bold color={color}>
        Botholomew
      </Text>
      <Text dimColor>Starting chat session...</Text>
    </Box>
  );
}

const CHAR_FRAMES = ["{o,o}", "{o,o}", "{-,-}", "{o,o}"];

export function LogoChar() {
  const [frameIndex, setFrameIndex] = useState(0);
  const { isIdle } = useIdle();

  useEffect(() => {
    if (isIdle) return;
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % CHAR_FRAMES.length);
    }, IDLE_MS);
    return () => clearInterval(interval);
  }, [isIdle]);

  return (
    <Text color={isIdle ? "gray" : theme.accent}>
      {CHAR_FRAMES[frameIndex]}{" "}
    </Text>
  );
}
