import { Box, Text } from "ink";
import { useEffect, useState } from "react";
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

const STARTUP_MS = 1200;
const IDLE_MS = 2000;

export function AnimatedLogo() {
  const [frameIndex, setFrameIndex] = useState(0);
  const [startupDone, setStartupDone] = useState(false);

  useEffect(() => {
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
  }, [startupDone]);

  const frames = startupDone ? IDLE_FRAMES : STARTUP_FRAMES;
  // biome-ignore lint: frameIndex is always in bounds
  const frame = frames[frameIndex]!;

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      {frame.map((line) => (
        <Text key={line} color={theme.accent}>
          {line}
        </Text>
      ))}
      <Text bold color={theme.accent}>
        Botholomew
      </Text>
      <Text dimColor>Starting chat session...</Text>
    </Box>
  );
}

const CHAR_FRAMES = ["{o,o}", "{o,o}", "{-,-}", "{o,o}"];

export function LogoChar() {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % CHAR_FRAMES.length);
    }, IDLE_MS);
    return () => clearInterval(interval);
  }, []);

  return <Text color={theme.accent}>{CHAR_FRAMES[frameIndex]} </Text>;
}
