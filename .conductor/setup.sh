#!/bin/bash
set -e

bun install

MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
if [ -d "$MAIN/.botholomew" ]; then
  cp -r "$MAIN/.botholomew" .botholomew
  echo "Copied .botholomew from $MAIN"
else
  echo "Warning: No .botholomew directory found in main worktree ($MAIN)"
  echo "Run 'bun dev init' in the main worktree first"
fi
