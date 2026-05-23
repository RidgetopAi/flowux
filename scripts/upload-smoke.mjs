#!/usr/bin/env node
import zlib from "node:zlib";

const baseUrl = process.env.FLOWUX_API_URL ?? "http://127.0.0.1:5174";

const textUpload = await upload({
  name: "flowux-upload-smoke.txt",
  mimeType: "text/plain",
  dataBase64: Buffer.from("Flowux upload smoke text: alpha-7319", "utf8").toString("base64")
});

const imageUpload = await upload({
  name: "flowux-upload-smoke.png",
  mimeType: "image/png",
  dataBase64: createPngBase64(32, 32, [35, 184, 166, 255])
});

const canvas = await fetchJson(`${baseUrl}/api/canvases`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Flowux Upload Smoke" })
});
console.log(`canvas ${canvas.id}`);

try {
  const response = await fetch(`${baseUrl}/api/canvases/${canvas.id}/prompts/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt:
        "Confirm you received the attached text file and image. Reply in one short sentence and include alpha-7319.",
      attachmentIds: [textUpload.id, imageUpload.id],
      layoutWidth: 1260,
      rowHeight: 430
    })
  });

  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

  const events = await readSse(response, Number(process.env.FLOWUX_UPLOAD_SMOKE_TIMEOUT_MS ?? 120_000));
  const complete = events.find((event) => event.event === "complete");
  if (!complete) throw new Error("upload smoke did not complete");
  console.log(
    events
      .slice(-50)
      .flatMap((event) => [`event: ${event.event}`, `data: ${JSON.stringify(event.data)}`])
      .join("\n")
  );
  const assistantResponse = complete.data?.mrp?.assistantResponse ?? "";
  if (!assistantResponse.includes("alpha-7319")) {
    throw new Error(`upload smoke completed without expected assistant response text: ${assistantResponse || "<empty>"}`);
  }
} finally {
  if (process.env.FLOWUX_UPLOAD_SMOKE_KEEP_CANVAS !== "1") {
    await fetch(`${baseUrl}/api/canvases/${canvas.id}`, { method: "DELETE" }).catch(() => {});
  }
}

async function upload(input) {
  return fetchJson(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function readSse(response, timeoutMs) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const timeoutAt = Date.now() + timeoutMs;
  let buffer = "";
  const events = [];
  while (true) {
    if (Date.now() > timeoutAt) throw new Error("stream timeout");
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(chunk);
      if (parsed) events.push(parsed);
      if (parsed?.event === "complete") return events;
      boundary = buffer.indexOf("\n\n");
    }
  }
  return events;
}

function parseSseEvent(chunk) {
  const lines = chunk.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!eventLine) return undefined;
  return {
    event: eventLine.slice("event:".length).trim(),
    data: dataLine ? JSON.parse(dataLine.slice("data:".length).trim()) : undefined
  };
}

function createPngBase64(width, height, rgba) {
  const payload = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    payload[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      payload[offset] = rgba[0];
      payload[offset + 1] = rgba[1];
      payload[offset + 2] = rgba[2];
      payload[offset + 3] = rgba[3];
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", zlib.deflateSync(payload)),
    pngChunk("IEND", Buffer.alloc(0))
  ]).toString("base64");
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
