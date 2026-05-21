#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run dev:api >/tmp/flowux-api-prompt-layout.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" >/dev/null 2>&1 || true' EXIT

sleep 4

canvas_id="$(
  curl -sS -X POST http://127.0.0.1:5174/api/canvases \
    -H "content-type: application/json" \
    --data-binary '{"title":"Prompt Layout Trace"}' |
    node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).id'
)"

for n in 1 2 3 4 5; do
  curl -sS -N \
    -X POST "http://127.0.0.1:5174/api/canvases/$canvas_id/prompts/stream" \
    -H "content-type: application/json" \
    --data-binary "{\"prompt\":\"layout $n\",\"layoutWidth\":1260,\"rowHeight\":430}" >/tmp/flowux-layout-stream-$n.txt
done

curl -sS "http://127.0.0.1:5174/api/canvases/$canvas_id" |
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

