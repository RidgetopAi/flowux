#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"
flowux_cd_root

export FLOWUX_HARNESS_MODE="${FLOWUX_HARNESS_MODE:-pi_mono}"
export FLOWUX_PI_MONO_PROVIDER="${FLOWUX_PI_MONO_PROVIDER:-xai}"
export FLOWUX_PI_MONO_MODEL="${FLOWUX_PI_MONO_MODEL:-grok-4.3}"
export FLOWUX_MODEL_NAME="${FLOWUX_MODEL_NAME:-$FLOWUX_PI_MONO_MODEL}"

echo "Flowux API: $FLOWUX_API_URL"
echo "Harness: $FLOWUX_HARNESS_MODE / $FLOWUX_PI_MONO_PROVIDER/$FLOWUX_PI_MONO_MODEL"
echo "Pi workspace: $FLOWUX_PI_MONO_REMOTE_HOST:$FLOWUX_PI_MONO_REMOTE_CWD"
echo "DB: $FLOWUX_DB_PATH"

exec flowux_tsx apps/api/src/server.ts
