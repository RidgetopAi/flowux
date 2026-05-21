import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import "./db/client.js";
import {
  appendMrpEvent,
  buildMessagesForPrompt,
  completePromptMrp,
  createCanvas,
  createPromptMrp,
  getCanvasSnapshot,
  listCanvases,
  snapBack,
  updatePlacement
} from "./services/flowuxRepository.js";
import { createModelAdapter } from "./model/adapter.js";

const config = loadConfig();
const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"]
});

app.get("/api/health", async () => ({
  ok: true,
  modelMode: config.modelMode,
  modelBaseUrl: config.modelBaseUrl,
  modelName: config.modelName,
  modelMaxTokens: config.modelMaxTokens
}));

app.get("/api/canvases", async () => listCanvases());

app.post<{ Body: { title?: string } }>("/api/canvases", async (request) => {
  return createCanvas(request.body?.title);
});

app.get<{ Params: { canvasId: string } }>("/api/canvases/:canvasId", async (request, reply) => {
  const snapshot = await getCanvasSnapshot(request.params.canvasId);
  if (!snapshot) return reply.code(404).send({ error: "canvas_not_found" });
  return snapshot;
});

app.patch<{
  Params: { canvasId: string; mrpId: string };
  Body: Record<string, unknown>;
}>("/api/canvases/:canvasId/placements/:mrpId", async (request, reply) => {
  const placement = await updatePlacement(request.params.canvasId, request.params.mrpId, request.body);
  if (!placement) return reply.code(404).send({ error: "placement_not_found" });
  return placement;
});

app.post<{ Params: { canvasId: string }; Body: { layoutWidth?: number; rowHeight?: number } }>(
  "/api/canvases/:canvasId/snap-back",
  async (request) => {
    return snapBack(request.params.canvasId, request.body?.layoutWidth, request.body?.rowHeight);
  }
);

app.post<{ Params: { canvasId: string }; Body: { prompt: string; layoutWidth?: number; rowHeight?: number } }>(
  "/api/canvases/:canvasId/prompts/stream",
  async (request, reply) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt) return reply.code(400).send({ error: "prompt_required" });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const messages = await buildMessagesForPrompt(request.params.canvasId, prompt);
      const created = await createPromptMrp(request.params.canvasId, prompt, {
        layoutWidth: request.body?.layoutWidth,
        rowHeight: request.body?.rowHeight
      });
      send("created", created);

      const adapter = createModelAdapter();
      let responseText = "";
      let thinkingText = "";
      let sawThinking = false;
      let sawResponse = false;
      let finishReason: string | undefined;
      let usage:
        | {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          }
        | undefined;

      await appendMrpEvent(created.mrp.id, created.modelRun.id, "model_stream_started", {
        provider: adapter.provider,
        model: adapter.model
      });

      for await (const event of adapter.generate({ messages })) {
        if (event.type === "thinking_delta") {
          thinkingText += event.text;
          if (!sawThinking) {
            sawThinking = true;
            await appendMrpEvent(created.mrp.id, created.modelRun.id, "thinking_started", {
              preview: event.text.slice(0, 120)
            });
          }
          send("thinking", { mrpId: created.mrp.id, token: event.text });
          continue;
        }

        if (event.type === "response_delta") {
          responseText += event.text;
          if (!sawResponse) {
            sawResponse = true;
            await appendMrpEvent(created.mrp.id, created.modelRun.id, "response_started", {
              preview: event.text.slice(0, 120)
            });
          }
          send("token", { mrpId: created.mrp.id, token: event.text });
          continue;
        }

        if (event.type === "usage") {
          usage = event.usage;
          await appendMrpEvent(created.mrp.id, created.modelRun.id, "usage_reported", { usage: event.usage });
          continue;
        }

        if (event.type === "done") {
          finishReason = event.finishReason;
          await appendMrpEvent(created.mrp.id, created.modelRun.id, "model_stream_done", {
            finishReason
          });
        }
      }

      const complete = await completePromptMrp(request.params.canvasId, created.mrp.id, {
        response: responseText,
        thinking: thinkingText,
        usage,
        finishReason
      });
      send("complete", { mrp: complete });
      reply.raw.end();
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : "unknown_error" });
      reply.raw.end();
    }
  }
);

await app.listen({ port: config.port, host: "0.0.0.0" });
