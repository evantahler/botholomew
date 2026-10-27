#!/bin/sh
# Install the prebuilt Botholomew standalone binary (no Bun or Node required).
#
#   curl -fsSL https://raw.githubusercontent.com/evantahler/botholomew/main/install.sh | sh
#
# Downloads the binary matching your OS/arch from the latest GitHub release and
# installs it as `botholomew` (with a `bothy` alias). Override the install dir
# with BOTHOLOMEW_BIN_DIR. For Windows, download the .exe from the releases page.
set -eu

REPO="evantahler/botholomew"
BIN_DIR="${BOTHOLOMEW_BIN_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "Unsupported OS: $os. See https://github.com/$REPO/releases" >&2; exit 1 ;;
esac
case "$arch" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="botholomew-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

echo "Downloading ${asset} from the latest release..."
tmp="$(mktemp)"
if ! curl -fsSL "$url" -o "$tmp"; then
  echo "Download failed: $url" >&2
  rm -f "$tmp"
  exit 1
fi
chmod +x "$tmp"

mkdir -p "$BIN_DIR"
mv "$tmp" "$BIN_DIR/botholomew"
ln -sf "$BIN_DIR/botholomew" "$BIN_DIR/bothy"

echo "Installed botholomew + bothy to $BIN_DIR"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add it to your PATH, e.g.:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

"$BIN_DIR/botholomew" --version
