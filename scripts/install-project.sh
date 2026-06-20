#!/usr/bin/env sh
set -eu

TARGET_DIR=".pi"
TARGET_FILE="$TARGET_DIR/settings.json"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PACKAGE_SOURCE="${CLAWA_PACKAGE_SOURCE:-$REPO_ROOT}"

mkdir -p "$TARGET_DIR"

if [ -e "$TARGET_FILE" ] && [ "${CLAWA_INSTALL_OVERWRITE:-0}" != "1" ]; then
  echo "Clawa project settings already exist at $TARGET_FILE" >&2
  echo "Set CLAWA_INSTALL_OVERWRITE=1 to replace them." >&2
  exit 1
fi

cat >"$TARGET_FILE" <<JSON
{
  "packages": ["$PACKAGE_SOURCE"],
  "sessionDir": ".pi/sessions"
}
JSON

echo "Wrote $TARGET_FILE"
echo "Run pi from this directory. Resume later with pi -c."
