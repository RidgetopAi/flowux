#!/usr/bin/env bash
set -euo pipefail

FLOWUX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLOWUX_NODE_BIN="${FLOWUX_NODE_BIN:-$HOME/.nvm/versions/node/v22.18.0/bin}"
if [ -d "$FLOWUX_NODE_BIN" ]; then
  export PATH="$FLOWUX_NODE_BIN:$PATH"
fi

export FLOWUX_DB_PATH="${FLOWUX_DB_PATH:-apps/api/flowux.db}"
export FLOWUX_API_PORT="${FLOWUX_API_PORT:-5174}"
export FLOWUX_API_URL="${FLOWUX_API_URL:-http://127.0.0.1:$FLOWUX_API_PORT}"
export FLOWUX_API_LOG="${FLOWUX_API_LOG:-/tmp/flowux-api-live.log}"
export FLOWUX_PI_BIN="${FLOWUX_PI_BIN:-pi}"
export FLOWUX_PI_CWD="${FLOWUX_PI_CWD:-$HOME/projects}"
export FLOWUX_PI_UPLOAD_DIR="${FLOWUX_PI_UPLOAD_DIR:-$HOME/.flowux/uploads}"

flowux_cd_root() {
  cd "$FLOWUX_ROOT"
}

flowux_tsx() {
  "$FLOWUX_ROOT/node_modules/.bin/tsx" "$@"
}

flowux_build_api_runtime() {
  npm run build -w @flowux/shared >/dev/null
  npm run build -w @flowux/api >/dev/null
}

flowux_node_api() {
  node "$FLOWUX_ROOT/apps/api/dist/server.js"
}
