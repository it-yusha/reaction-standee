#!/usr/bin/env bash
set -euo pipefail

RESOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cat "$RESOURCE_DIR/project-root.txt")"
SERVER_URL="http://127.0.0.1:5173/"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/ReactionStandee.log"

if curl --silent --fail --max-time 1 "$SERVER_URL" >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$LOG_DIR"

NPM_BIN=""
NPM_CANDIDATES=(
  "/usr/local/bin/npm"
  "/opt/homebrew/bin/npm"
  "$HOME"/.nvm/versions/node/*/bin/npm
)

for candidate in "${NPM_CANDIDATES[@]}"; do
  if [[ -x "$candidate" ]]; then
    NPM_BIN="$candidate"
  fi
done

if [[ -z "$NPM_BIN" ]]; then
  printf "npmが見つかりませんでした。\n" >>"$LOG_FILE"
  exit 1
fi

export PATH="$(dirname "$NPM_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$ROOT_DIR"
nohup "$NPM_BIN" run dev -- --host 127.0.0.1 >>"$LOG_FILE" 2>&1 </dev/null &
