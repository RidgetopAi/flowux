import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import "./db/client.js";
import { getExecutionContext } from "./executionContext.js";
import {
  appendMrpEvent,
  applyContextBundle,
  buildMessagesForPrompt,
  buildPromptContextBudget,
  compactCanvas,
  completePromptMrp,
  createCanvas,
  createChildCanvasFromSelection,
  createPromptMrp,
  deleteContextBundle,
  editStateSnapshot,
  failPromptMrp,
  getCanvasSnapshot,
  getMrpDetails,
  importExternalMrps,
  listCanvases,
  saveContextBundleFromSelection,
  searchWorkspace,
  setMrpPinned,
  snapBack,
  deleteCanvas,
  updateCanvasStatus,
  updateCanvasTitle,
  updateCanvasSelection,
  updatePlacement
} from "./services/flowuxRepository.js";
import {
  createHarnessAdapter,
  listTargets,
  getTarget,
  setActiveTarget,
  resolveTarget,
  pingTarget
} from "./harness/index.js";
import { prepareAttachmentDelivery } from "./services/attachmentDelivery.js";
import { loadUpload, readUploadBytes, saveUpload } from "./services/uploadService.js";

const config = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 16 * 1024 * 1024 });
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

app.get("/api/health", async () => {
  const pi = config.harnessMode === "pi_mono" ? resolveTarget() : undefined;
  return {
    ok: true,
    harnessMode: config.harnessMode,
    modelMode: config.modelMode,
    modelBaseUrl: config.modelBaseUrl,
    modelName: pi?.model ?? config.modelName,
    modelMaxTokens: pi?.maxOutputTokens ?? config.modelMaxTokens,
    contextWindow: pi?.contextWindow ?? config.modelContextWindow,
    maxOutputTokens: pi?.maxOutputTokens ?? config.modelMaxTokens,
    piMonoCwd: pi?.cwd ?? config.piMonoCwd,
    piMonoProvider: pi?.provider ?? config.piMonoProvider,
    piMonoModel: pi?.model ?? config.piMonoModel,
    activeTargetId: pi?.id,
    executionContext: getExecutionContext(config)
  };
});

// ── Pi targets: list / switch / connectivity-test ─────────────────────────
app.get("/api/pi/targets", async () => listTargets());

app.post<{ Body: { id?: string } }>("/api/pi/target", async (request, reply) => {
  const id = request.body?.id;
  if (!id) return reply.code(400).send({ error: "target_id_required" });
  const target = setActiveTarget(id);
  if (!target) return reply.code(404).send({ error: "unknown_target", id });
  return { ...listTargets(), executionContext: getExecutionContext(config) };
});

app.post<{ Params: { id: string } }>("/api/pi/target/:id/test", async (request, reply) => {
  const target = getTarget(request.params.id);
  if (!target) return reply.code(404).send({ error: "unknown_target", id: request.params.id });
  return pingTarget(target);
});

app.get("/api/canvases", async () => listCanvases());

app.get<{ Querystring: { q?: string; limit?: string } }>("/api/search", async (request) =>
  searchWorkspace(request.query.q ?? "", Number(request.query.limit ?? 30))
);

app.post<{ Params: { canvasId: string }; Body: { prompt?: string; attachmentIds?: string[] } }>(
  "/api/canvases/:canvasId/context-estimate",
  async (request, reply) => {
    const attachmentIds = Array.from(new Set(request.body?.attachmentIds ?? []));
    const attachments = (await Promise.all(attachmentIds.map((attachmentId) => loadUpload(attachmentId)))).filter(
      (attachment): attachment is Awaited<ReturnType<typeof loadUpload>> & {} => Boolean(attachment)
    );
    const pi = config.harnessMode === "pi_mono" ? resolveTarget(request.params.canvasId) : undefined;
    const unsupportedImages = attachments.filter((attachment) => attachment.type === "image");
    if (unsupportedImages.length && !(pi?.supportsImages ?? false)) {
      return reply.code(400).send({
        error: "image_model_input_not_supported",
        message:
          "The active Pi target does not accept image pixels. Switch to a Grok target for image inputs, or remove image attachments."
      });
    }
    const prompt = request.body?.prompt?.trim() || (attachments.length ? "Please review the attached file(s)." : "");
    const delivery = await prepareAttachmentDelivery(config, attachments, { stageRemote: false, includeImageData: false });
    const modelPrompt = [prompt, delivery.promptText].filter(Boolean).join("\n\n");
    return {
      canvasId: request.params.canvasId,
      prompt,
      budget: await buildPromptContextBudget(
        request.params.canvasId,
        modelPrompt,
        pi?.contextWindow ?? config.modelContextWindow,
        pi?.maxOutputTokens ?? config.modelMaxTokens
      )
    };
  }
);

app.post<{ Body: { name?: string; mimeType?: string; dataBase64?: string } }>("/api/uploads", async (request, reply) => {
  try {
    return await saveUpload({
      name: request.body?.name ?? "",
      mimeType: request.body?.mimeType,
      dataBase64: request.body?.dataBase64 ?? ""
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upload_failed";
    return reply.code(message === "upload_too_large" ? 413 : 400).send({ error: message });
  }
});

app.get<{ Params: { uploadId: string; fileName: string } }>("/api/uploads/:uploadId/:fileName", async (request, reply) => {
  const loaded = await readUploadBytes(request.params.uploadId);
  if (!loaded) return reply.code(404).send({ error: "upload_not_found" });
  if (loaded.upload.mimeType) reply.header("content-type", loaded.upload.mimeType);
  reply.header("content-disposition", `inline; filename="${loaded.upload.name.replace(/"/g, "'")}"`);
  return reply.send(loaded.buffer);
});

app.post<{ Body: { title?: string } }>("/api/canvases", async (request) => {
  return createCanvas(request.body?.title);
});

app.patch<{ Params: { canvasId: string }; Body: { title?: string; status?: "temporary" | "saved" } }>(
  "/api/canvases/:canvasId",
  async (request, reply) => {
  try {
    const canvas =
      request.body?.status === "saved" || request.body?.status === "temporary"
        ? await updateCanvasStatus(request.params.canvasId, request.body.status)
        : await updateCanvasTitle(request.params.canvasId, request.body?.title ?? "");
    if (!canvas) return reply.code(404).send({ error: "canvas_not_found" });
    return canvas;
  } catch (error) {
    const message = error instanceof Error ? error.message : "canvas_update_failed";
    if (message === "title_required") return reply.code(400).send({ error: message });
    throw error;
  }
}
);

app.delete<{ Params: { canvasId: string } }>("/api/canvases/:canvasId", async (request, reply) => {
  try {
    return await deleteCanvas(request.params.canvasId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "canvas_delete_failed";
    if (message === "canvas_not_found") return reply.code(404).send({ error: message });
    throw error;
  }
});

app.post<{
  Params: { canvasId: string };
  Body: { sourceMrpIds?: string[] } | undefined;
}>("/api/canvases/:canvasId/branches", async (request, reply) => {
  try {
    const explicit = Array.isArray(request.body?.sourceMrpIds)
      ? request.body!.sourceMrpIds!.filter((id) => typeof id === "string" && id.length > 0)
      : undefined;
    return await createChildCanvasFromSelection(request.params.canvasId, explicit);
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

app.get<{ Params: { canvasId: string }; Querystring: { summary?: string } }>("/api/canvases/:canvasId", async (request, reply) => {
  const snapshot = await getCanvasSnapshot(request.params.canvasId, { summaryOnly: request.query.summary === "true" });
  if (!snapshot) return reply.code(404).send({ error: "canvas_not_found" });
  return snapshot;
});

app.get<{ Params: { canvasId: string; mrpId: string } }>("/api/canvases/:canvasId/mrps/:mrpId/details", async (request, reply) => {
  const details = await getMrpDetails(request.params.canvasId, request.params.mrpId);
  if (!details) return reply.code(404).send({ error: "mrp_not_found" });
  return details;
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

/* ── Compaction ───────────────────────────────────────────────────── */
app.post<{
  Params: { canvasId: string };
  Body: { mrpIds?: string[]; trigger?: "user" | "auto" | "manual_edit" };
}>("/api/canvases/:canvasId/compact", async (request, reply) => {
  try {
    const result = await compactCanvas(request.params.canvasId, {
      ...(request.body?.mrpIds ? { mrpIds: request.body.mrpIds } : {}),
      ...(request.body?.trigger ? { trigger: request.body.trigger } : {})
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "compaction_failed";
    if (message === "canvas_not_found") return reply.code(404).send({ error: message });
    if (message === "nothing_to_compact") return reply.code(400).send({ error: message });
    if (message.startsWith("compaction_parse_failed")) {
      return reply.code(502).send({ error: "compaction_parse_failed", detail: message });
    }
    return reply.code(500).send({ error: message });
  }
});

app.patch<{ Params: { mrpId: string }; Body: { pinned?: boolean } }>(
  "/api/mrps/:mrpId",
  async (request, reply) => {
    if (typeof request.body?.pinned !== "boolean") {
      return reply.code(400).send({ error: "pinned_required" });
    }
    try {
      const mrp = await setMrpPinned(request.params.mrpId, request.body.pinned);
      return mrp;
    } catch (err) {
      const message = err instanceof Error ? err.message : "pin_failed";
      if (message === "mrp_not_found") return reply.code(404).send({ error: message });
      return reply.code(500).send({ error: message });
    }
  }
);

app.patch<{
  Params: { canvasId: string; snapshotId: string };
  Body: Partial<import("@flowux/shared").StateDocument>;
}>("/api/canvases/:canvasId/state-snapshots/:snapshotId", async (request, reply) => {
  try {
    const snapshot = await editStateSnapshot(
      request.params.canvasId,
      request.params.snapshotId,
      request.body ?? {}
    );
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : "snapshot_edit_failed";
    if (message === "snapshot_not_found") return reply.code(404).send({ error: message });
    if (message === "snapshot_canvas_mismatch") return reply.code(400).send({ error: message });
    if (message === "summary_required") return reply.code(400).send({ error: message });
    return reply.code(500).send({ error: message });
  }
});

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
  Body: {
    prompt?: string;
    attachmentIds?: string[];
    layoutWidth?: number;
    layoutLeft?: number;
    layoutTop?: number;
    rowHeight?: number;
  };
}>(
  "/api/canvases/:canvasId/prompts/stream",
  async (request, reply) => {
    const attachmentIds = Array.from(new Set(request.body?.attachmentIds ?? []));
    const attachments = (await Promise.all(attachmentIds.map((attachmentId) => loadUpload(attachmentId)))).filter(
      (attachment): attachment is Awaited<ReturnType<typeof loadUpload>> & {} => Boolean(attachment)
    );
    const pi = config.harnessMode === "pi_mono" ? resolveTarget(request.params.canvasId) : undefined;
    if (attachments.some((attachment) => attachment.type === "image") && !(pi?.supportsImages ?? false)) {
      return reply.code(400).send({
        error: "image_model_input_not_supported",
        message:
          "The active Pi target does not accept image pixels. Switch to a Grok target for image inputs, or remove image attachments."
      });
    }
    const prompt = request.body?.prompt?.trim() || (attachments.length ? "Please review the attached file(s)." : "");
    if (!prompt) return reply.code(400).send({ error: "prompt_required" });
    if (activePromptRuns.has(request.params.canvasId)) {
      return reply.code(409).send({ error: "prompt_already_running" });
    }
    const delivery = await prepareAttachmentDelivery(config, attachments, { stageRemote: true, includeImageData: true });
    const modelPrompt = [prompt, delivery.promptText].filter(Boolean).join("\n\n");

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
      const messages = await buildMessagesForPrompt(request.params.canvasId, modelPrompt);
      const contextBudget = await buildPromptContextBudget(
        request.params.canvasId,
        modelPrompt,
        pi?.contextWindow ?? config.modelContextWindow,
        pi?.maxOutputTokens ?? config.modelMaxTokens
      );
      created = await createPromptMrp(
        request.params.canvasId,
        prompt,
        {
          layoutWidth: request.body?.layoutWidth,
          layoutLeft: request.body?.layoutLeft,
          layoutTop: request.body?.layoutTop,
          rowHeight: request.body?.rowHeight
        },
        attachments,
        contextBudget
      );
      activePromptRuns.set(request.params.canvasId, {
        abortController,
        mrpId: created.mrp.id,
        startedAt: created.modelRun.startedAt
      });
      send("created", { ...created, contextBudget });

      const adapter = createHarnessAdapter(request.params.canvasId);
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
        capabilities: adapter.capabilities,
        contextBudget,
        attachmentDelivery: delivery.items.map(({ attachment, modelDelivery, remotePath }) => ({
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          mimeType: attachment.mimeType,
          modelDelivery,
          remotePath
        })),
        imageInputs: delivery.images.length
      });

      for await (const event of adapter.generate({
        messages,
        prompt: modelPrompt,
        canvasId: request.params.canvasId,
        mrpId: created.mrp.id,
        modelRunId: created.modelRun.id,
        executionContext: getExecutionContext(config, request.params.canvasId),
        images: delivery.images,
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
