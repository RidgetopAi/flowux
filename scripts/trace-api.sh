#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -f flowux.db
npm run db:migrate >/tmp/flowux-migrate.log 2>&1

npm run dev:api >/tmp/flowux-api-trace.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" >/dev/null 2>&1 || true' EXIT

sleep 4

echo "== health =="
curl -sS http://127.0.0.1:5174/api/health
echo

echo "== create canvas =="
curl -sS -o /tmp/flowux-create.json \
  -X POST http://127.0.0.1:5174/api/canvases \
  -H "content-type: application/json" \
  --data-binary '{"title":"Trace Test Canvas"}'
cat /tmp/flowux-create.json
echo

canvas_id="$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/flowux-create.json", "utf8")).id')"
echo "canvas=$canvas_id"

echo "== prompt stream =="
curl -sS -N \
  -X POST "http://127.0.0.1:5174/api/canvases/$canvas_id/prompts/stream" \
  -H "content-type: application/json" \
  --data-binary '{"prompt":"Trace the first Flowux prompt path."}' |
  sed -n '1,80p'

echo "== snapshot =="
curl -sS "http://127.0.0.1:5174/api/canvases/$canvas_id"
echo

