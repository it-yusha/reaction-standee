#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="ReactionStandeeWKPreview.app"
SOURCE_APP="$ROOT_DIR/.build/wk-record-preview/$APP_NAME"
TARGET_DIR="$HOME/Applications"
TARGET_APP="$TARGET_DIR/$APP_NAME"

WK_RECORD_PREVIEW_BUILD_ONLY=1 "$ROOT_DIR/scripts/run-wk-record-preview.sh" >/dev/null

mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_APP"
cp -R "$SOURCE_APP" "$TARGET_APP"

echo "$TARGET_APP"
