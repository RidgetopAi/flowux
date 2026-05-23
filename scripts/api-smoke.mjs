#!/usr/bin/env node
const baseUrl = process.env.FLOWUX_API_URL ?? "http://127.0.0.1:5174";
const prompt = process.env.FLOWUX_SMOKE_PROMPT ?? "Reply with exactly: Flowux API smoke ok.";

const canvas = await fetch(`${baseUrl}/api/canvases`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Flowux API Smoke" })
}).then(assertJson);

console.log(`canvas ${canvas.id}`);

try {
  const response = await fetch(`${baseUrl}/api/canvases/${canvas.id}/prompts/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, layoutWidth: 1260, rowHeight: 430 })
  });

  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const timeoutAt = Date.now() + Number(process.env.FLOWUX_SMOKE_TIMEOUT_MS ?? 90_000);
  let buffer = "";

  while (true) {
    if (Date.now() > timeoutAt) throw new Error("stream timeout");
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    if (buffer.includes("event: complete")) break;
  }

  console.log(buffer.split("\n").filter((line) => line.startsWith("event:") || line.startsWith("data:")).slice(-80).join("\n"));
} finally {
  await fetch(`${baseUrl}/api/canvases/${canvas.id}`, { method: "DELETE" }).catch(() => {});
}

async function assertJson(response) {
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}
