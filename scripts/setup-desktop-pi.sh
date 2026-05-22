#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${FLOWUX_PI_MONO_REMOTE_HOST:-ridgetop@ridgetop-desktop}"
NODE_VERSION="${FLOWUX_PI_MONO_NODE_VERSION:-v22.22.3}"
MODEL_BASE_URL="${FLOWUX_MODEL_BASE_URL:-http://100.122.105.69:5005}"
MODEL_NAME="${FLOWUX_MODEL_NAME:-qwen3.6-35b}"

ssh "$REMOTE_HOST" 'bash -s' <<SCRIPT
set -euo pipefail

NODE_VERSION="$NODE_VERSION"
MODEL_BASE_URL="$MODEL_BASE_URL"
MODEL_NAME="$MODEL_NAME"
INSTALL_ROOT=/home/ridgetop/.local/flowux
NODE_DIR="\$INSTALL_ROOT/node-\$NODE_VERSION-linux-x64"

mkdir -p "\$INSTALL_ROOT" /home/ridgetop/projects /home/ridgetop/.pi/agent

if [ ! -x "\$NODE_DIR/bin/node" ]; then
  cd "\$INSTALL_ROOT"
  curl -L "https://nodejs.org/dist/\$NODE_VERSION/node-\$NODE_VERSION-linux-x64.tar.xz" -o "node-\$NODE_VERSION.tar.xz"
  tar -xf "node-\$NODE_VERSION.tar.xz"
  rm "node-\$NODE_VERSION.tar.xz"
fi

export PATH="\$NODE_DIR/bin:\$PATH"

if [ ! -d /home/ridgetop/projects/pi-mono/.git ]; then
  git clone --depth 1 https://github.com/badlogic/pi-mono.git /home/ridgetop/projects/pi-mono
fi

cat > /home/ridgetop/.pi/agent/models.json <<JSON
{
  "providers": {
    "local-qwen": {
      "baseUrl": "$MODEL_BASE_URL/v1",
      "api": "openai-completions",
      "apiKey": "llama-cpp",
      "compat": {
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsUsageInStreaming": true,
        "maxTokensField": "max_tokens",
        "thinkingFormat": "qwen"
      },
      "models": [
        {
          "id": "$MODEL_NAME",
          "name": "Qwen Local",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 2048,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
JSON

cd /home/ridgetop/projects/pi-mono
npm install
npm run build
node packages/coding-agent/dist/cli.js --list-models local-qwen
SCRIPT
