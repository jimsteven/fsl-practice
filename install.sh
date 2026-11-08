#!/bin/sh
# Run from an extracted GitHub ZIP; no Git, Node or administrator access needed.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VERSION=24.11.0
case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) echo 'Use install.ps1 on Windows. Supported systems: macOS and glibc Linux.' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo 'Supported processors: x64 and ARM64.' >&2; exit 1 ;;
esac
RUNTIME="$ROOT/.tools/node-runtime"
if [ ! -x "$RUNTIME/bin/node" ] || [ "$("$RUNTIME/bin/node" -p 'process.version + "/" + process.arch' 2>/dev/null)" != "v$VERSION/$ARCH" ]; then
  [ ! -e "$RUNTIME" ] || { echo "Move the existing $RUNTIME aside and retry; it is not the expected Node runtime." >&2; exit 1; }
  command -v curl >/dev/null || { echo 'curl is required. Install it with your OS package manager, then retry.' >&2; exit 1; }
  command -v tar >/dev/null || { echo 'tar is required. Install it with your OS package manager, then retry.' >&2; exit 1; }
  mkdir -p "$ROOT/.tools"
  TEMP=$(mktemp -d "$ROOT/.tools/node-download.XXXXXX")
  trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
  FILE="node-v$VERSION-$OS-$ARCH.tar.gz"
  BASE="https://nodejs.org/dist/v$VERSION"
  echo "Downloading Node $VERSION for $OS/$ARCH..."
  curl --fail --location --retry 3 "$BASE/$FILE" -o "$TEMP/$FILE"
  curl --fail --location --retry 3 "$BASE/SHASUMS256.txt" -o "$TEMP/SHASUMS256.txt"
  EXPECTED=$(awk -v file="$FILE" '$2 == file { print $1 }' "$TEMP/SHASUMS256.txt")
  if command -v sha256sum >/dev/null; then
    ACTUAL=$(sha256sum "$TEMP/$FILE" | awk '{ print $1 }')
  else
    ACTUAL=$(shasum -a 256 "$TEMP/$FILE" | awk '{ print $1 }')
  fi
  [ -n "$EXPECTED" ] && [ "$ACTUAL" = "$EXPECTED" ] || { echo 'Node checksum mismatch; refusing to install.' >&2; exit 1; }
  tar -xzf "$TEMP/$FILE" -C "$TEMP"
  [ ! -e "$RUNTIME" ] || { echo 'Runtime directory appeared during installation; retry.' >&2; exit 1; }
  mv "$TEMP/node-v$VERSION-$OS-$ARCH" "$RUNTIME"
  rm -rf "$TEMP"
  trap - EXIT HUP INT TERM
fi
export PATH="$RUNTIME/bin:$PATH"
exec "$RUNTIME/bin/node" "$ROOT/scripts/install.mjs" "$@"
