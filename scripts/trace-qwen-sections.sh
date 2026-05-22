#!/usr/bin/env bash
set -euo pipefail

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # Keep native modules on the same Node ABI the dev server uses.
  export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${FLOWUX_TRACE_DB_PATH:-/tmp/flowux-qwen-sections-trace.db}"
API_PORT="${FLOWUX_TRACE_API_PORT:-6177}"
MODEL_BASE_URL="${FLOWUX_MODEL_BASE_URL:-http://100.122.105.69:5005}"
MODEL_NAME="${FLOWUX_MODEL_NAME:-qwen3.6-35b}"
MODEL_MAX_TOKENS="${FLOWUX_MODEL_MAX_TOKENS:-2048}"
LOG_PATH="${FLOWUX_TRACE_LOG_PATH:-/tmp/flowux-qwen-sections-trace.log}"

rm -f "$DB_PATH" "$DB_PATH"-* "$LOG_PATH"

cd "$ROOT_DIR"

FLOWUX_DB_PATH="$DB_PATH" npm run db:migrate >/tmp/flowux-qwen-sections-migrate.log 2>&1

FLOWUX_DB_PATH="$DB_PATH" \
  FLOWUX_API_PORT="$API_PORT" \
  FLOWUX_MODEL_MODE=llama_cpp \
  FLOWUX_MODEL_BASE_URL="$MODEL_BASE_URL" \
  FLOWUX_MODEL_NAME="$MODEL_NAME" \
  FLOWUX_MODEL_MAX_TOKENS="$MODEL_MAX_TOKENS" \
  npx tsx apps/api/src/server.ts >"$LOG_PATH" 2>&1 &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
  rm -f "$DB_PATH" "$DB_PATH"-*
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sS --max-time 1 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

node --input-type=module <<'NODE'
const port = process.env.FLOWUX_TRACE_API_PORT ?? "6177";
const baseUrl = `http://127.0.0.1:${port}`;

const canvas = await fetch(`${baseUrl}/api/canvases`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Qwen Section Trace" })
}).then((response) => response.json());

const stream = await fetch(`${baseUrl}/api/canvases/${canvas.id}/prompts/stream`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prompt: "Think briefly, then answer in one short sentence: confirm Flowux can separate Qwen thinking from final response.",
    layoutWidth: 1260,
    rowHeight: 430
  })
});

if (!stream.ok) {
  throw new Error(`stream failed: ${stream.status} ${await stream.text()}`);
}

const decoder = new TextDecoder();
let buffer = "";
let thinkingChars = 0;
let responseChars = 0;
let completeMrpId = "";

for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const eventTexts = buffer.split("\n\n");
  buffer = eventTexts.pop() ?? "";

  for (const eventText of eventTexts) {
    const event = eventText.match(/^event: (.+)$/m)?.[1];
    const dataText = eventText.match(/^data: (.+)$/m)?.[1];
    if (!event || !dataText) continue;

    const data = JSON.parse(dataText);
    if (event === "thinking") thinkingChars += data.token.length;
    if (event === "token") responseChars += data.token.length;
    if (event === "complete") completeMrpId = data.mrp.id;
    if (event === "error") throw new Error(data.message);
  }
}

const snapshot = await fetch(`${baseUrl}/api/canvases/${canvas.id}`).then((response) => response.json());
const mrp = snapshot.mrps[0];

console.log(JSON.stringify(
  {
    canvasId: canvas.id,
    completeMrpId,
    mrpStatus: mrp.status,
    thinkingChars,
    responseChars,
    sections: snapshot.sections.map((section) => section.kind),
    blocks: snapshot.blocks.map((block) => block.kind),
    events: snapshot.events.map((event) => event.type),
    assistantResponsePreview: (mrp.assistantResponse ?? "").slice(0, 180).replace(/\s+/g, " ")
  },
  null,
  2
));
NODE
