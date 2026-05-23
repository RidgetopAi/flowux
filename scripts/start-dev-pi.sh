#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
export FLOWUX_HARNESS_MODE="${FLOWUX_HARNESS_MODE:-pi_mono}"
export FLOWUX_MODEL_MODE="${FLOWUX_MODEL_MODE:-llama_cpp}"
export FLOWUX_MODEL_BASE_URL="${FLOWUX_MODEL_BASE_URL:-http://100.122.105.69:5005}"
export FLOWUX_MODEL_NAME="${FLOWUX_MODEL_NAME:-qwen3.6-35b}"
export FLOWUX_MODEL_MAX_TOKENS="${FLOWUX_MODEL_MAX_TOKENS:-2048}"
export FLOWUX_PI_MONO_REMOTE_HOST="${FLOWUX_PI_MONO_REMOTE_HOST:-ridgetop@ridgetop-desktop}"
export FLOWUX_PI_MONO_REMOTE_CWD="${FLOWUX_PI_MONO_REMOTE_CWD:-/home/ridgetop/projects}"
export FLOWUX_PI_MONO_COMMAND="${FLOWUX_PI_MONO_COMMAND:-PATH=/home/ridgetop/.local/flowux/node-v22.22.3-linux-x64/bin:\$PATH PI_OFFLINE=1 node /home/ridgetop/projects/pi-mono/packages/coding-agent/dist/cli.js --mode rpc --provider local-qwen --model qwen3.6-35b --no-session --no-context-files --thinking minimal}"

npm run dev
