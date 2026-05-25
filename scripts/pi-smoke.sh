#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"

provider="${FLOWUX_PI_MONO_PROVIDER:-xai}"
model="${FLOWUX_PI_MONO_MODEL:-grok-4.3}"
thinking="${FLOWUX_PI_MONO_THINKING:-minimal}"
message="${FLOWUX_PI_SMOKE_PROMPT:-Reply with exactly: Pi RPC smoke ok.}"
bin="${FLOWUX_PI_BIN:-pi}"
cwd="${FLOWUX_PI_CWD:-$HOME/projects}"
wait_seconds="${FLOWUX_PI_SMOKE_TIMEOUT_SECONDS:-60}"

if [ "$provider" = "xai" ] && [ -z "${XAI_API_KEY:-}" ]; then
  echo "WARNING: XAI_API_KEY env not set in this shell. Pi will still pick up keys from ~/.pi/agent/auth.json if present." >&2
fi

echo "Pi smoke (local): $bin in $cwd  $provider/$model"

# Pi RPC mode shuts down on stdin close, so we feed it the prompt then hold
# stdin open with sleep. awk watches the event stream and exits on agent_end
# (success) or on a prompt-rejection response (failure). pipefail surfaces
# awk's exit code as the script's exit code.
set -o pipefail
message_json=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$message")

(
  printf '{"id":"smoke","type":"prompt","message":%s}\n' "$message_json"
  sleep "$wait_seconds"
) | (
  cd "$cwd"
  "$bin" --mode rpc --provider "$provider" --model "$model" \
    --no-session --no-context-files --no-extensions --no-skills --no-tools \
    --thinking "$thinking"
) | awk '
  { print }
  /"type":"agent_end"/   { exit 0 }
  /"success":false/      { exit 1 }
'
