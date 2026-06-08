#!/usr/bin/env bash
set -euo pipefail

# Desktop VISION target: pi runs ON ridgetop-desktop over ssh (the
# `desktop-local` PiTarget), driving the local qwen3.6-35b vision server
# (llama.cpp --mmproj on :5005). Images are delivered inline as base64 over the
# RPC channel, which rides the ssh stdin/stdout pipe transparently — no scp.
#
# Requires (one-time, on the DESKTOP): ~/.pi/agent/models.json provider
# `local-qwen` with the qwen model declaring `"input": ["text","image"]` so pi
# forwards image content to the vision server.

source "$(dirname "$0")/lib/flowux-env.sh"
flowux_cd_root

export FLOWUX_HARNESS_MODE="${FLOWUX_HARNESS_MODE:-pi_mono}"
export FLOWUX_PI_ACTIVE_TARGET="${FLOWUX_PI_ACTIVE_TARGET:-desktop-local}"
# Light up images for the desktop qwen target (it's vision-capable via --mmproj
# but isn't grok, so the isGrok default would leave it text-only).
export FLOWUX_PI_REMOTE_SUPPORTS_IMAGES="${FLOWUX_PI_REMOTE_SUPPORTS_IMAGES:-true}"

echo "Flowux API: $FLOWUX_API_URL"
echo "Harness: $FLOWUX_HARNESS_MODE / target=$FLOWUX_PI_ACTIVE_TARGET (ssh → desktop pi)"
echo "Vision: images=$FLOWUX_PI_REMOTE_SUPPORTS_IMAGES (inline base64 over RPC)"
echo "DB: $FLOWUX_DB_PATH"

exec "$FLOWUX_ROOT/node_modules/.bin/tsx" watch apps/api/src/server.ts
