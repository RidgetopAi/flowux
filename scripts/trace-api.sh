#!/usr/bin/env bash
set -euo pipefail

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # Keep native modules on the same Node ABI the dev server uses.
  export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
fi

cd "$(dirname "$0")/.."

port="${FLOWUX_TRACE_PORT:-6174}"
db_path="${FLOWUX_TRACE_DB:-/tmp/flowux-trace-api-$$.db}"
base_url="http://127.0.0.1:$port"

rm -f "$db_path" "$db_path-shm" "$db_path-wal"
export FLOWUX_DB_PATH="$db_path"
export FLOWUX_API_PORT="$port"

npm run db:migrate >/tmp/flowux-migrate.log 2>&1

npm run dev:api >/tmp/flowux-api-trace.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" >/dev/null 2>&1 || true; rm -f "$db_path" "$db_path-shm" "$db_path-wal"' EXIT

sleep 4

echo "== health =="
curl -sS "$base_url/api/health"
echo

echo "== create canvas =="
curl -sS -o /tmp/flowux-create.json \
  -X POST "$base_url/api/canvases" \
  -H "content-type: application/json" \
  --data-binary '{"title":"Trace Test Canvas"}'
cat /tmp/flowux-create.json
echo

canvas_id="$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/flowux-create.json", "utf8")).id')"
echo "canvas=$canvas_id"

echo "== prompt stream =="
curl -sS -N \
  -X POST "$base_url/api/canvases/$canvas_id/prompts/stream" \
  -H "content-type: application/json" \
  --data-binary '{"prompt":"Trace the first Flowux prompt path."}' |
  sed -n '1,80p'

echo "== snapshot =="
curl -sS "$base_url/api/canvases/$canvas_id"
echo
