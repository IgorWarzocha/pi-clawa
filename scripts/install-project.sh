#!/usr/bin/env sh
set -eu

BASE_URL="${CLAWA_INSTALL_BASE:-https://raw.githubusercontent.com/howaboua/pi-claw/main}"
TARGET_DIR=".pi"
TARGET_FILE="$TARGET_DIR/settings.json"
SOURCE_URL="$BASE_URL/install/pi-settings.json"

mkdir -p "$TARGET_DIR"

if [ -e "$TARGET_FILE" ] && [ "${CLAWA_INSTALL_OVERWRITE:-0}" != "1" ]; then
  echo "Clawa project settings already exist at $TARGET_FILE" >&2
  echo "Set CLAWA_INSTALL_OVERWRITE=1 to replace them." >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$SOURCE_URL" -o "$TARGET_FILE"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TARGET_FILE" "$SOURCE_URL"
else
  echo "Need curl or wget to download $SOURCE_URL" >&2
  exit 1
fi

echo "Wrote $TARGET_FILE"
echo "Run pi from this directory to install project packages."
