#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"

provider="${FLOWUX_PI_MONO_PROVIDER:-xai}"
model="${FLOWUX_PI_MONO_MODEL:-grok-4.3}"
thinking="${FLOWUX_PI_MONO_THINKING:-minimal}"
message="${FLOWUX_PI_SMOKE_PROMPT:-Reply with exactly: Pi RPC smoke ok.}"
bin="${FLOWUX_PI_BIN:-pi}"
cwd="${FLOWUX_PI_CWD:-$HOME/projects}"

if [ "$provider" = "xai" ] && [ -z "${XAI_API_KEY:-}" ]; then
  echo "WARNING: XAI_API_KEY is not set; xai requests will hang waiting for auth." >&2
fi

echo "Pi smoke (local): $bin in $cwd  $provider/$model"
printf '%s\n' "{\"id\":\"smoke\",\"type\":\"prompt\",\"message\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$message")}" |
  (cd "$cwd" && timeout "${FLOWUX_PI_SMOKE_TIMEOUT:-60s}" \
    "$bin" --mode rpc --provider "$provider" --model "$model" \
      --no-session --no-context-files --no-extensions --no-skills \
      --thinking "$thinking")
