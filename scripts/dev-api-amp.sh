#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"
flowux_cd_root

export FLOWUX_HARNESS_MODE="${FLOWUX_HARNESS_MODE:-ampcode}"
export FLOWUX_AMP_BIN="${FLOWUX_AMP_BIN:-amp}"
export FLOWUX_AMP_MODE="${FLOWUX_AMP_MODE:-smart}"
export FLOWUX_AMP_CWD="${FLOWUX_AMP_CWD:-$HOME/projects}"
export FLOWUX_MODEL_NAME="${FLOWUX_MODEL_NAME:-amp:$FLOWUX_AMP_MODE}"

echo "Flowux API: $FLOWUX_API_URL"
echo "Harness: $FLOWUX_HARNESS_MODE / amp:$FLOWUX_AMP_MODE"
echo "Amp (local): $FLOWUX_AMP_BIN  cwd=$FLOWUX_AMP_CWD"
echo "DB: $FLOWUX_DB_PATH"
if [ -z "${AMP_API_KEY:-}" ] && [ ! -f "$HOME/.config/amp/settings.json" ]; then
  echo "WARNING: AMP_API_KEY unset and ~/.config/amp/settings.json missing — amp will fail auth."
fi

exec "$FLOWUX_ROOT/node_modules/.bin/tsx" watch apps/api/src/server.ts
