#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

port="${FLOWUX_TRACE_PORT:-6176}"
db_path="${FLOWUX_TRACE_DB:-/tmp/flowux-trace-prompt-layout-$$.db}"
base_url="http://127.0.0.1:$port"

rm -f "$db_path" "$db_path-shm" "$db_path-wal"
export FLOWUX_DB_PATH="$db_path"
export FLOWUX_API_PORT="$port"
npm run db:migrate >/tmp/flowux-migrate-prompt-layout.log 2>&1

npm run dev:api >/tmp/flowux-api-prompt-layout.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" >/dev/null 2>&1 || true; rm -f "$db_path" "$db_path-shm" "$db_path-wal"' EXIT

sleep 4

canvas_id="$(
  curl -sS -X POST "$base_url/api/canvases" \
    -H "content-type: application/json" \
    --data-binary '{"title":"Prompt Layout Trace"}' |
    node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).id'
)"

for n in 1 2 3 4 5; do
  curl -sS -N \
    -X POST "$base_url/api/canvases/$canvas_id/prompts/stream" \
    -H "content-type: application/json" \
    --data-binary "{\"prompt\":\"layout $n\",\"layoutWidth\":1260,\"rowHeight\":430}" >/tmp/flowux-layout-stream-$n.txt
done

curl -sS "$base_url/api/canvases/$canvas_id" |
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const snapshot = JSON.parse(input);
      console.log(JSON.stringify(snapshot.placements.map((placement) => ({
        mrpId: placement.mrpId,
        x: placement.x,
        y: placement.y
      }))));
    });
  '
