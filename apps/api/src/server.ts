import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import "./db/client.js";
import {
  appendMrpEvent,
  applyContextBundle,
  buildMessagesForPrompt,
  completePromptMrp,
  createCanvas,
  createChildCanvasFromSelection,
  createPromptMrp,
  deleteContextBundle,
  failPromptMrp,
  getCanvasSnapshot,
  importExternalMrps,
  listCanvases,
  saveContextBundleFromSelection,
  snapBack,
  deleteCanvas,
  updateCanvasTitle,
  updateCanvasSelection,
  updatePlacement
} from "./services/flowuxRepository.js";
import { createHarnessAdapter } from "./harness/index.js";

const config = loadConfig();
const app = Fastify({ logger: true });
const activePromptRuns = new Map<
  string,
  {
    abortController: AbortController;
    mrpId?: string;
    startedAt: string;
  }
>();

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
});

app.get("/api/health", async () => ({
  ok: true,
  harnessMode: config.harnessMode,
  modelMode: config.modelMode,
  modelBaseUrl: config.modelBaseUrl,
  modelName: config.modelName,
  modelMaxTokens: config.modelMaxTokens,
  piMonoRemoteHost: config.piMonoRemoteHost,
  piMonoRemoteCwd: config.piMonoRemoteCwd
}));

app.get("/api/canvases", async () => listCanvases());

app.post<{ Body: { title?: string } }>("/api/canvases", async (request) => {
  return createCanvas(request.body?.title);
});

app.patch<{ Params: { canvasId: string }; Body: { title?: string } }>("/api/canvases/:canvasId", async (request, reply) => {
  try {
    const canvas = await updateCanvasTitle(request.params.canvasId, request.body?.title ?? "");
    if (!canvas) return reply.code(404).send({ error: "canvas_not_found" });
    return canvas;
  } catch (error) {
    const message = error instanceof Error ? error.message : "canvas_update_failed";
    if (message === "title_required") return reply.code(400).send({ error: message });
    throw error;
  }
});

app.delete<{ Params: { canvasId: string } }>("/api/canvases/:canvasId", async (request, reply) => {
  try {
    return await deleteCanvas(request.params.canvasId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "canvas_delete_failed";
    if (message === "canvas_not_found") return reply.code(404).send({ error: message });
    throw error;
  }
});

app.post<{ Params: { canvasId: string } }>("/api/canvases/:canvasId/branches", async (request, reply) => {
  try {
    return await createChildCanvasFromSelection(request.params.canvasId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "branch_create_failed";
    if (message === "parent_canvas_not_found") return reply.code(404).send({ error: message });
    if (message === "selected_mrps_required" || message === "selected_mrps_not_found") {
      return reply.code(400).send({ error: message });
    }
    throw error;
  }
});

app.post<{
  Params: { canvasId: string };
  Body: { mrpIds?: string[]; layout?: { layoutWidth?: number; layoutLeft?: number; layoutTop?: number; rowHeight?: number } };
}>("/api/canvases/:canvasId/references", async (request, reply) => {
  try {
    return await importExternalMrps(request.params.canvasId, request.body?.mrpIds ?? [], request.body?.layout ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "references_import_failed";
    if (message === "canvas_not_found") return reply.code(404).send({ error: message });
    if (message === "mrp_ids_required" || message === "source_mrps_not_found" || message === "no_importable_mrps") {
      return reply.code(400).send({ error: message });
    }
    throw error;
  }
});

app.post<{ Params: { canvasId: string }; Body: { name?: string } }>(
  "/api/canvases/:canvasId/context-bundles",
  async (request, reply) => {
    try {
      return await saveContextBundleFromSelection(request.params.canvasId, request.body?.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "context_bundle_create_failed";
      if (message === "canvas_not_found") return reply.code(404).send({ error: message });
      if (message === "selected_mrps_required" || message === "selected_mrps_not_found") {
        return reply.code(400).send({ error: message });
      }
      throw error;
    }
  }
);

app.post<{ Params: { canvasId: string; bundleId: string } }>(
  "/api/canvases/:canvasId/context-bundles/:bundleId/apply",
  async (request, reply) => {
    try {
      return await applyContextBundle(request.params.canvasId, request.params.bundleId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "context_bundle_apply_failed";
      if (message === "context_bundle_not_found") return reply.code(404).send({ error: message });
      throw error;
    }
  }
);

app.delete<{ Params: { canvasId: string; bundleId: string } }>(
  "/api/canvases/:canvasId/context-bundles/:bundleId",
  async (request, reply) => {
    try {
      return await deleteContextBundle(request.params.canvasId, request.params.bundleId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "context_bundle_delete_failed";
      if (message === "context_bundle_not_found") return reply.code(404).send({ error: message });
      throw error;
    }
  }
);

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

app.post<{ Params: { canvasId: string } }>("/api/canvases/:canvasId/prompts/cancel", async (request, reply) => {
  const activeRun = activePromptRuns.get(request.params.canvasId);
  if (!activeRun) return reply.code(404).send({ error: "no_active_prompt" });
  activeRun.abortController.abort();
  return {
    cancelled: true,
    canvasId: request.params.canvasId,
    mrpId: activeRun.mrpId,
    startedAt: activeRun.startedAt
  };
});

app.patch<{ Params: { canvasId: string }; Body: { selectedForContext?: boolean } }>(
  "/api/canvases/:canvasId/placements",
  async (request) => {
    return updateCanvasSelection(request.params.canvasId, Boolean(request.body?.selectedForContext));
  }
);

app.post<{
  Params: { canvasId: string };
  Body: { layoutWidth?: number; layoutLeft?: number; layoutTop?: number; rowHeight?: number };
}>(
  "/api/canvases/:canvasId/snap-back",
  async (request) => {
    return snapBack(
      request.params.canvasId,
      request.body?.layoutWidth,
      request.body?.rowHeight,
      request.body?.layoutLeft,
      request.body?.layoutTop
    );
  }
);

app.post<{
  Params: { canvasId: string };
  Body: { prompt: string; layoutWidth?: number; layoutLeft?: number; layoutTop?: number; rowHeight?: number };
}>(
  "/api/canvases/:canvasId/prompts/stream",
  async (request, reply) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt) return reply.code(400).send({ error: "prompt_required" });
    if (activePromptRuns.has(request.params.canvasId)) {
      return reply.code(409).send({ error: "prompt_already_running" });
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });

    const abortController = new AbortController();
    activePromptRuns.set(request.params.canvasId, {
      abortController,
      startedAt: new Date().toISOString()
    });
    let streamClosed = false;
    reply.raw.on("close", () => {
      if (!streamClosed) abortController.abort();
    });

    const send = (event: string, data: unknown) => {
      if (reply.raw.destroyed) return;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let created: Awaited<ReturnType<typeof createPromptMrp>> | undefined;
    try {
      const messages = await buildMessagesForPrompt(request.params.canvasId, prompt);
      created = await createPromptMrp(request.params.canvasId, prompt, {
        layoutWidth: request.body?.layoutWidth,
        layoutLeft: request.body?.layoutLeft,
        layoutTop: request.body?.layoutTop,
        rowHeight: request.body?.rowHeight
      });
      activePromptRuns.set(request.params.canvasId, {
        abortController,
        mrpId: created.mrp.id,
        startedAt: created.modelRun.startedAt
      });
      send("created", created);

      const adapter = createHarnessAdapter();
      let responseText = "";
      let thinkingText = "";
      let sawThinking = false;
      let sawResponse = false;
      const toolCalls: Array<Record<string, unknown>> = [];
      const toolResults: Array<Record<string, unknown>> = [];
      const rawEvents: Array<Record<string, unknown>> = [];
      let finishReason: string | undefined;
      let errorMessage: string | undefined;
      let usage:
        | {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          }
        | undefined;

      await appendMrpEvent(created.mrp.id, created.modelRun.id, "model_stream_started", {
        provider: adapter.provider,
        model: adapter.model,
        harnessMode: adapter.mode,
        capabilities: adapter.capabilities
      });

      for await (const event of adapter.generate({
        messages,
        prompt,
        canvasId: request.params.canvasId,
        mrpId: created.mrp.id,
        modelRunId: created.modelRun.id,
        signal: abortController.signal
      })) {
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

        if (event.type === "tool_call_started" || event.type === "tool_call_delta" || event.type === "tool_call_completed") {
          toolCalls.push({
            type: event.type,
            toolCall: event.toolCall,
            ...(event.type === "tool_call_delta" ? { delta: event.delta } : {})
          });
          await appendMrpEvent(created.mrp.id, created.modelRun.id, event.type, {
            toolCall: event.toolCall,
            ...(event.type === "tool_call_delta" ? { delta: event.delta } : {})
          });
          continue;
        }

        if (event.type === "tool_result_delta" || event.type === "tool_result_completed") {
          toolResults.push({
            type: event.type,
            toolResult: event.toolResult
          });
          await appendMrpEvent(created.mrp.id, created.modelRun.id, event.type, {
            toolResult: event.toolResult
          });
          continue;
        }

        if (event.type === "usage") {
          usage = event.usage;
          await appendMrpEvent(created.mrp.id, created.modelRun.id, "usage_reported", { usage: event.usage });
          continue;
        }

        if (event.type === "raw_event") {
          rawEvents.push({
            type: event.eventType,
            raw: event.raw
          });
          await appendMrpEvent(created.mrp.id, created.modelRun.id, "raw_event", {
            eventType: event.eventType,
            raw: event.raw
          });
          continue;
        }

        if (event.type === "error") {
          errorMessage = event.message;
          await appendMrpEvent(created.mrp.id, created.modelRun.id, "model_error", {
            message: event.message,
            raw: event.raw
          });
          send("error", { message: event.message });
          continue;
        }

        if (event.type === "done") {
          finishReason = event.finishReason;
          await appendMrpEvent(created.mrp.id, created.modelRun.id, "model_stream_done", {
            finishReason
          });
        }
      }

      if (errorMessage && !responseText) {
        const failed = await failPromptMrp(request.params.canvasId, created.mrp.id, errorMessage);
        send("complete", { mrp: failed });
        reply.raw.end();
        return;
      }

      const complete = await completePromptMrp(request.params.canvasId, created.mrp.id, {
        response: responseText,
        thinking: thinkingText,
        usage,
        finishReason,
        toolCalls,
        toolResults,
        rawEvents
      });
      send("complete", { mrp: complete });
      streamClosed = true;
      reply.raw.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      send("error", { message });
      if (created) {
        const failed = await failPromptMrp(request.params.canvasId, created.mrp.id, message);
        send("complete", { mrp: failed });
      }
      streamClosed = true;
      reply.raw.end();
    } finally {
      const activeRun = activePromptRuns.get(request.params.canvasId);
      if (activeRun?.abortController === abortController) {
        activePromptRuns.delete(request.params.canvasId);
      }
    }
  }
);

await app.listen({ port: config.port, host: "0.0.0.0" });
