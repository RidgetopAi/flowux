#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"

provider="${FLOWUX_PI_MONO_PROVIDER:-xai}"
model="${FLOWUX_PI_MONO_MODEL:-grok-4.3}"
thinking="${FLOWUX_PI_MONO_THINKING:-minimal}"
message="${FLOWUX_PI_SMOKE_PROMPT:-Reply with exactly: Pi RPC smoke ok.}"

remote_command=$(
  printf "cd %q && env PATH=/home/ridgetop/.local/flowux/node-v22.22.3-linux-x64/bin:\\\$PATH node /home/ridgetop/projects/pi-mono/packages/coding-agent/dist/cli.js --mode rpc --provider %q --model %q --no-session --no-context-files --thinking %q" \
    "$FLOWUX_PI_MONO_REMOTE_CWD" \
    "$provider" \
    "$model" \
    "$thinking"
)

echo "Pi smoke: $FLOWUX_PI_MONO_REMOTE_HOST:$FLOWUX_PI_MONO_REMOTE_CWD $provider/$model"
printf '%s\n' "{\"id\":\"smoke\",\"type\":\"prompt\",\"message\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$message")}" |
  timeout "${FLOWUX_PI_SMOKE_TIMEOUT:-60s}" ssh "$FLOWUX_PI_MONO_REMOTE_HOST" "$remote_command"
