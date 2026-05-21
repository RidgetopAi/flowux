#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run dev:api >/tmp/flowux-api-snap.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" >/dev/null 2>&1 || true' EXIT

sleep 4

canvas_id="$(
  curl -sS -X POST http://127.0.0.1:5174/api/canvases \
    -H "content-type: application/json" \
    --data-binary '{"title":"Snap Width Trace"}' |
    node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).id'
)"

for n in 1 2 3 4; do
  curl -sS -N \
    -X POST "http://127.0.0.1:5174/api/canvases/$canvas_id/prompts/stream" \
    -H "content-type: application/json" \
    --data-binary "{\"prompt\":\"snap $n\"}" >/tmp/flowux-snap-stream-$n.txt
done

curl -sS \
  -X POST "http://127.0.0.1:5174/api/canvases/$canvas_id/snap-back" \
  -H "content-type: application/json" \
  --data-binary '{"layoutWidth":1260,"rowHeight":720}' |
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const placements = JSON.parse(input);
      console.log(JSON.stringify(placements.map((placement) => ({
        x: placement.x,
        y: placement.y
      }))));
    });
  '
