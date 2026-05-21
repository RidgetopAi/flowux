import { and, eq, max } from "drizzle-orm";
import {
  buildContextMessages,
  type CanvasPlacement,
  type CanvasSnapshot,
  type CanvasThread,
  type CreatePromptResponse,
  type ModelRun,
  type Mrp
} from "@flowux/shared";
import { db } from "../db/client.js";
import { canvasPlacements, canvasThreads, modelRuns, mrps } from "../db/schema.js";
import { createModelAdapter } from "../model/adapter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export async function listCanvases(): Promise<CanvasThread[]> {
  const rows = await db.select().from(canvasThreads).orderBy(canvasThreads.updatedAt);
  return rows.map(toCanvasThread);
}

export async function createCanvas(title = "Untitled Flowux Canvas"): Promise<CanvasThread> {
  const timestamp = now();
  const canvas: CanvasThread = {
    id: id(),
    title,
    status: "temporary",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString()
  };
  await db.insert(canvasThreads).values(canvas);
  return canvas;
}

export async function getCanvasSnapshot(canvasId: string): Promise<CanvasSnapshot | undefined> {
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) return undefined;

  const canvasMrps = await db.select().from(mrps).where(eq(mrps.canvasId, canvasId)).orderBy(mrps.sequence);
  const placements = await db
    .select()
    .from(canvasPlacements)
    .where(eq(canvasPlacements.canvasId, canvasId));

  return {
    canvas: toCanvasThread(canvas),
    mrps: canvasMrps.map(toMrp),
    placements: placements.map(toPlacement),
    branches: []
  };
}

export async function updatePlacement(
  canvasId: string,
  mrpId: string,
  patch: Partial<Pick<CanvasPlacement, "x" | "y" | "width" | "height" | "collapsed" | "selectedForContext" | "connectionHidden">>
): Promise<CanvasPlacement | undefined> {
  await db
    .update(canvasPlacements)
    .set({ ...patch, updatedAt: now() })
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, mrpId)));

  const [placement] = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, mrpId)));
  return placement ? toPlacement(placement) : undefined;
}

export async function snapBack(canvasId: string): Promise<CanvasPlacement[]> {
  const canvasMrps = await db.select().from(mrps).where(eq(mrps.canvasId, canvasId)).orderBy(mrps.sequence);
  const timestamp = now();

  for (const mrp of canvasMrps) {
    await db
      .update(canvasPlacements)
      .set({
        x: 120 + ((mrp.sequence - 1) % 3) * 420,
        y: 120 + Math.floor((mrp.sequence - 1) / 3) * 300,
        updatedAt: timestamp
      })
      .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, mrp.id)));
  }

  const rows = await db.select().from(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  return rows.map(toPlacement);
}

export async function createPromptMrp(canvasId: string, prompt: string): Promise<CreatePromptResponse> {
  const timestamp = now();
  const [sequenceRow] = await db
    .select({ value: max(mrps.sequence) })
    .from(mrps)
    .where(eq(mrps.canvasId, canvasId));
  const maxSequence = sequenceRow?.value ?? 0;
  const sequence = (maxSequence ?? 0) + 1;

  const mrp: Mrp = {
    id: id(),
    canvasId,
    sequence,
    userPrompt: prompt,
    assistantResponse: "",
    title: prompt.slice(0, 64),
    summary: prompt.slice(0, 180),
    status: "streaming",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const placement: CanvasPlacement = {
    id: id(),
    canvasId,
    mrpId: mrp.id,
    originCanvasId: undefined,
    isExternalReference: false,
    x: 120 + ((sequence - 1) % 3) * 420,
    y: 120 + Math.floor((sequence - 1) / 3) * 300,
    width: 360,
    height: 240,
    collapsed: false,
    selectedForContext: false,
    connectionHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const selectedPlacements = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.selectedForContext, true)));
  const inputMrpIds = selectedPlacements.map((item) => item.mrpId);

  const adapter = createModelAdapter();
  const modelRun: ModelRun = {
    id: id(),
    canvasId,
    mrpId: mrp.id,
    provider: adapter.provider,
    model: adapter.model,
    inputMrpIds,
    startedAt: timestamp
  };

  mrp.modelRunId = modelRun.id;

  await db.insert(mrps).values(mrp);
  await db.insert(canvasPlacements).values(placement);
  await db.insert(modelRuns).values(modelRun);
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  return { mrp, placement, modelRun };
}

export async function completePromptMrp(canvasId: string, mrpId: string, response: string): Promise<Mrp> {
  const timestamp = now();
  const summary = response.split(/\s+/).slice(0, 32).join(" ");
  await db
    .update(mrps)
    .set({
      assistantResponse: response,
      summary,
      status: "complete",
      updatedAt: timestamp
    })
    .where(and(eq(mrps.canvasId, canvasId), eq(mrps.id, mrpId)));

  await db
    .update(modelRuns)
    .set({ completedAt: timestamp })
    .where(eq(modelRuns.mrpId, mrpId));

  const [mrp] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  if (!mrp) throw new Error(`MRP ${mrpId} was not found after completion`);
  return toMrp(mrp);
}

export async function buildMessagesForPrompt(canvasId: string, prompt: string) {
  const canvasMrps = await db.select().from(mrps).where(eq(mrps.canvasId, canvasId));
  const placements = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.selectedForContext, true)));

  return buildContextMessages({
    mrps: canvasMrps.map(toMrp).filter((mrp) => mrp.status === "complete"),
    selectedMrpIds: placements.map((placement) => placement.mrpId),
    systemPrompt: "You are Flowux, a spatial AI workspace assistant. Preserve project reasoning and answer concisely.",
    currentPrompt: prompt
  });
}

function toCanvasThread(row: typeof canvasThreads.$inferSelect): CanvasThread {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    ...(row.parentCanvasId ? { parentCanvasId: row.parentCanvasId } : {}),
    ...(row.parentBranchId ? { parentBranchId: row.parentBranchId } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.modelConfigId ? { modelConfigId: row.modelConfigId } : {})
  };
}

function toMrp(row: typeof mrps.$inferSelect): Mrp {
  return {
    id: row.id,
    canvasId: row.canvasId,
    sequence: row.sequence,
    userPrompt: row.userPrompt,
    assistantResponse: row.assistantResponse,
    ...(row.title ? { title: row.title } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.modelRunId ? { modelRunId: row.modelRunId } : {})
  };
}

function toPlacement(row: typeof canvasPlacements.$inferSelect): CanvasPlacement {
  return {
    id: row.id,
    canvasId: row.canvasId,
    mrpId: row.mrpId,
    ...(row.originCanvasId ? { originCanvasId: row.originCanvasId } : {}),
    isExternalReference: row.isExternalReference,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    collapsed: row.collapsed,
    selectedForContext: row.selectedForContext,
    connectionHidden: row.connectionHidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
