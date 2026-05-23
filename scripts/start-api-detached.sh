#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"
flowux_cd_root

mode="${1:-grok}"
case "$mode" in
  grok)
    export FLOWUX_HARNESS_MODE="${FLOWUX_HARNESS_MODE:-pi_mono}"
    export FLOWUX_PI_MONO_PROVIDER="${FLOWUX_PI_MONO_PROVIDER:-xai}"
    export FLOWUX_PI_MONO_MODEL="${FLOWUX_PI_MONO_MODEL:-grok-4.3}"
    export FLOWUX_MODEL_NAME="${FLOWUX_MODEL_NAME:-$FLOWUX_PI_MONO_MODEL}"
    ;;
  qwen)
    export FLOWUX_HARNESS_MODE="${FLOWUX_HARNESS_MODE:-pi_mono}"
    export FLOWUX_PI_MONO_PROVIDER="${FLOWUX_PI_MONO_PROVIDER:-local-qwen}"
    export FLOWUX_PI_MONO_MODEL="${FLOWUX_PI_MONO_MODEL:-qwen3.6-35b}"
    export FLOWUX_PI_MONO_OFFLINE="${FLOWUX_PI_MONO_OFFLINE:-1}"
    export FLOWUX_MODEL_MODE="${FLOWUX_MODEL_MODE:-llama_cpp}"
    export FLOWUX_MODEL_BASE_URL="${FLOWUX_MODEL_BASE_URL:-http://100.122.105.69:5005}"
    export FLOWUX_MODEL_NAME="${FLOWUX_MODEL_NAME:-$FLOWUX_PI_MONO_MODEL}"
    ;;
  *)
    echo "Usage: scripts/start-api-detached.sh [grok|qwen]" >&2
    exit 2
    ;;
esac

if command -v fuser >/dev/null 2>&1; then
  fuser -k "$FLOWUX_API_PORT/tcp" >/dev/null 2>&1 || true
fi

rm -f "$FLOWUX_API_LOG"
flowux_build_api_runtime
launcher=(env
  "PATH=$PATH"
  "FLOWUX_DB_PATH=$FLOWUX_DB_PATH"
  "FLOWUX_API_PORT=$FLOWUX_API_PORT"
  "FLOWUX_HARNESS_MODE=$FLOWUX_HARNESS_MODE"
  "FLOWUX_PI_MONO_PROVIDER=$FLOWUX_PI_MONO_PROVIDER"
  "FLOWUX_PI_MONO_MODEL=$FLOWUX_PI_MONO_MODEL"
  "FLOWUX_MODEL_NAME=$FLOWUX_MODEL_NAME"
  "FLOWUX_MODEL_MODE=${FLOWUX_MODEL_MODE:-mock}"
  "FLOWUX_MODEL_BASE_URL=${FLOWUX_MODEL_BASE_URL:-http://127.0.0.1:5005}"
  "FLOWUX_PI_MONO_OFFLINE=${FLOWUX_PI_MONO_OFFLINE:-}"
  node "$FLOWUX_ROOT/apps/api/dist/server.js")

if command -v setsid >/dev/null 2>&1; then
  setsid "${launcher[@]}" </dev/null >"$FLOWUX_API_LOG" 2>&1 &
else
  nohup "${launcher[@]}" </dev/null >"$FLOWUX_API_LOG" 2>&1 &
fi

pid=$!
echo "Started Flowux API ($mode) pid=$pid"
echo "Log: $FLOWUX_API_LOG"
sleep 1
curl -sS --max-time 5 "$FLOWUX_API_URL/api/health" || {
  echo
  echo "API did not become healthy. Log tail:"
  tail -80 "$FLOWUX_API_LOG" || true
  exit 1
}
echo
