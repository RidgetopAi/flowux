#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${FLOWUX_TRACE_DB_PATH:-/tmp/flowux-pi-harness-trace.db}"
API_PORT="${FLOWUX_TRACE_API_PORT:-6181}"
LOG_PATH="${FLOWUX_TRACE_LOG_PATH:-/tmp/flowux-pi-harness-api.log}"

rm -f "$DB_PATH" "$DB_PATH"-* "$LOG_PATH"

cd "$ROOT_DIR"

FLOWUX_DB_PATH="$DB_PATH" npm run db:migrate >/tmp/flowux-pi-harness-migrate.log 2>&1

FLOWUX_DB_PATH="$DB_PATH" \
  FLOWUX_API_PORT="$API_PORT" \
  FLOWUX_HARNESS_MODE=pi_mono \
  FLOWUX_PI_MONO_REMOTE_HOST="${FLOWUX_PI_MONO_REMOTE_HOST:-ridgetop@ridgetop-desktop}" \
  FLOWUX_PI_MONO_REMOTE_CWD="${FLOWUX_PI_MONO_REMOTE_CWD:-/home/ridgetop/projects}" \
  FLOWUX_PI_MONO_COMMAND="${FLOWUX_PI_MONO_COMMAND:-PATH=/home/ridgetop/.local/flowux/node-v22.22.3-linux-x64/bin:\$PATH PI_OFFLINE=1 node /home/ridgetop/projects/pi-mono/packages/coding-agent/dist/cli.js --mode rpc --provider local-qwen --model qwen3.6-35b --no-session --no-context-files --no-tools --thinking minimal}" \
  npx tsx apps/api/src/server.ts >"$LOG_PATH" 2>&1 &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
  rm -f "$DB_PATH" "$DB_PATH"-*
}
trap cleanup EXIT

for _ in $(seq 1 80); do
  if curl -sS --max-time 1 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

node --input-type=module <<'NODE'
const port = process.env.FLOWUX_TRACE_API_PORT ?? "6181";
const baseUrl = `http://127.0.0.1:${port}`;

const canvas = await fetch(`${baseUrl}/api/canvases`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Pi Harness Trace" })
}).then((response) => response.json());

const stream = await fetch(`${baseUrl}/api/canvases/${canvas.id}/prompts/stream`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prompt: process.env.FLOWUX_TRACE_PROMPT ?? "Reply with one short sentence saying Pi harness is connected.",
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
const errors = [];

for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const packets = buffer.split("\n\n");
  buffer = packets.pop() ?? "";

  for (const packet of packets) {
    const event = packet.match(/^event: (.+)$/m)?.[1];
    const dataText = packet.match(/^data: (.+)$/m)?.[1];
    if (!event || !dataText) continue;

    const data = JSON.parse(dataText);
    if (event === "thinking") thinkingChars += data.token.length;
    if (event === "token") responseChars += data.token.length;
    if (event === "error") errors.push(data.message);
  }
}

const [health, snapshot] = await Promise.all([
  fetch(`${baseUrl}/api/health`).then((response) => response.json()),
  fetch(`${baseUrl}/api/canvases/${canvas.id}`).then((response) => response.json())
]);
const mrp = snapshot.mrps[0];
const modelRun = snapshot.modelRuns[0];

console.log(JSON.stringify(
  {
    harnessMode: health.harnessMode,
    remoteHost: health.piMonoRemoteHost,
    remoteCwd: health.piMonoRemoteCwd,
    mrpStatus: mrp?.status,
    mrpTitle: mrp?.title,
    mrpSummary: mrp?.summary,
    assistantResponse: mrp?.assistantResponse,
    modelRun,
    thinkingChars,
    responseChars,
    errors,
    sections: snapshot.sections.map((section) => section.kind),
    blocks: snapshot.blocks.map((block) => block.kind),
    events: snapshot.events.map((event) => event.type).slice(0, 40),
    usage: snapshot.blocks.find((block) => block.kind === "usage")?.content
  },
  null,
  2
));
NODE
