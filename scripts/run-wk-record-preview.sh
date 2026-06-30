#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
URL="${1:-http://127.0.0.1:5173/record?camera=low&inferFps=30}"

SOURCE_FILE="$ROOT_DIR/macos/WKRecordPreview/Sources/WKRecordPreview/main.swift"
PLIST_FILE="$ROOT_DIR/macos/WKRecordPreview/Info.plist"
APP_DIR="${TMPDIR:-/tmp}/reaction-standee-wk-record-preview/ReactionStandeeWKPreview.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
BINARY_FILE="$MACOS_DIR/ReactionStandeeWKPreview"
MODULE_CACHE_DIR="$ROOT_DIR/.build/clang-module-cache"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"
mkdir -p "$MODULE_CACHE_DIR"
cp "$PLIST_FILE" "$CONTENTS_DIR/Info.plist"
cp "$ROOT_DIR/scripts/start-reaction-standee-server.sh" "$RESOURCES_DIR/start-server.sh"
printf "%s\n" "$ROOT_DIR" > "$RESOURCES_DIR/project-root.txt"
chmod +x "$RESOURCES_DIR/start-server.sh"
printf "APPL????" > "$CONTENTS_DIR/PkgInfo"

export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE_DIR"

swiftc \
  -O \
  -framework AppKit \
  -framework WebKit \
  "$SOURCE_FILE" \
  -o "$BINARY_FILE"

xattr -cr "$APP_DIR" 2>/dev/null || true
find "$APP_DIR" -print0 | xargs -0 xattr -d com.apple.provenance 2>/dev/null || true
find "$APP_DIR" -print0 | xargs -0 xattr -d com.apple.FinderInfo 2>/dev/null || true
find "$APP_DIR" -print0 | xargs -0 xattr -d "com.apple.fileprovider.fpfs#P" 2>/dev/null || true
codesign --force --deep --sign - "$APP_DIR" >/dev/null

if [[ "${WK_RECORD_PREVIEW_BUILD_ONLY:-0}" == "1" ]]; then
  echo "$APP_DIR"
  exit 0
fi

open -n "$APP_DIR" --args "$URL"
