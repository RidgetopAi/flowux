import { and, desc, eq, inArray, max } from "drizzle-orm";
import {
  buildContextMessages,
  type CanvasPlacement,
  type CanvasSnapshot,
  type CanvasThread,
  type CreatePromptResponse,
  type ModelRun,
  type Mrp,
  type MrpBlock,
  type MrpBlockKind,
  type MrpEvent,
  type MrpSection,
  type MrpSectionKind
} from "@flowux/shared";
import { db } from "../db/client.js";
import { canvasPlacements, canvasThreads, modelRuns, mrpBlocks, mrpEvents, mrps, mrpSections } from "../db/schema.js";
import { createModelAdapter } from "../model/adapter.js";
import type { TokenUsage } from "../model/adapter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export async function listCanvases(): Promise<CanvasThread[]> {
  const rows = await db.select().from(canvasThreads).orderBy(desc(canvasThreads.updatedAt));
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
  const mrpIds = canvasMrps.map((mrp) => mrp.id);
  const placements = await db
    .select()
    .from(canvasPlacements)
    .where(eq(canvasPlacements.canvasId, canvasId));
  const sections = mrpIds.length
    ? await db.select().from(mrpSections).where(inArray(mrpSections.mrpId, mrpIds)).orderBy(mrpSections.sequence)
    : [];
  const blocks = mrpIds.length
    ? await db.select().from(mrpBlocks).where(inArray(mrpBlocks.mrpId, mrpIds)).orderBy(mrpBlocks.sequence)
    : [];
  const events = mrpIds.length
    ? await db.select().from(mrpEvents).where(inArray(mrpEvents.mrpId, mrpIds)).orderBy(mrpEvents.sequence)
    : [];

  return {
    canvas: toCanvasThread(canvas),
    mrps: canvasMrps.map(toMrp),
    placements: placements.map(toPlacement),
    sections: sections.map(toMrpSection),
    blocks: blocks.map(toMrpBlock),
    events: events.map(toMrpEvent),
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

interface LayoutMetrics {
  layoutWidth?: number;
  rowHeight?: number;
}

export async function snapBack(canvasId: string, layoutWidth = 1260, rowHeight = 600): Promise<CanvasPlacement[]> {
  const canvasMrps = await db.select().from(mrps).where(eq(mrps.canvasId, canvasId)).orderBy(mrps.sequence);
  const timestamp = now();

  for (const mrp of canvasMrps) {
    const position = getChronologicalPosition(mrp.sequence, { layoutWidth, rowHeight });
    await db
      .update(canvasPlacements)
      .set({
        x: position.x,
        y: position.y,
        updatedAt: timestamp
      })
      .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, mrp.id)));
  }

  const rows = await db.select().from(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  return rows.map(toPlacement);
}

export async function createPromptMrp(
  canvasId: string,
  prompt: string,
  layout: LayoutMetrics = {}
): Promise<CreatePromptResponse> {
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

  const position = getChronologicalPosition(sequence, layout);
  const placement: CanvasPlacement = {
    id: id(),
    canvasId,
    mrpId: mrp.id,
    originCanvasId: undefined,
    isExternalReference: false,
    x: position.x,
    y: position.y,
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
  await createSectionWithBlock(mrp.id, "prompt", "Prompt", 1, "text", { text: prompt }, {
    collapsedByDefault: false,
    selectable: true,
    contextDefault: "include"
  });
  await createSectionWithBlock(
    mrp.id,
    "context_sent",
    "Context Sent",
    2,
    "event",
    { inputMrpIds, mode: "full_mrp", ordering: "canonical_sequence" },
    {
      collapsedByDefault: true,
      selectable: true,
      contextDefault: "exclude",
      summary: `${inputMrpIds.length} selected MRP${inputMrpIds.length === 1 ? "" : "s"}`
    }
  );
  await appendMrpEvent(mrp.id, modelRun.id, "turn_started", {
    provider: modelRun.provider,
    model: modelRun.model,
    inputMrpIds
  });
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  return { mrp, placement, modelRun };
}

function getChronologicalPosition(sequence: number, layout: LayoutMetrics) {
  const cardWidth = 360;
  const gapX = 60;
  const gapY = 28;
  const margin = 120;
  const rowHeight = layout.rowHeight ?? 600;
  const layoutWidth = layout.layoutWidth ?? 1260;
  const safeRowHeight = Math.max(360, Math.min(1200, rowHeight));
  const usableWidth = Math.max(cardWidth, layoutWidth - margin);
  const columns = Math.max(1, Math.floor((usableWidth + gapX) / (cardWidth + gapX)));
  const index = sequence - 1;

  return {
    x: margin + (index % columns) * (cardWidth + gapX),
    y: margin + Math.floor(index / columns) * (safeRowHeight + gapY)
  };
}

export interface CompletePromptInput {
  response: string;
  thinking?: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export async function completePromptMrp(canvasId: string, mrpId: string, input: CompletePromptInput): Promise<Mrp> {
  const timestamp = now();
  const response = input.response;
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
    .set({
      completedAt: timestamp,
      promptTokens: input.usage?.promptTokens,
      completionTokens: input.usage?.completionTokens,
      totalTokens: input.usage?.totalTokens,
      finishReason: input.finishReason
    })
    .where(eq(modelRuns.mrpId, mrpId));

  if (response) {
    await createSectionWithBlock(mrpId, "response", "Response", 3, "text", { text: response }, {
      collapsedByDefault: false,
      selectable: true,
      contextDefault: "include",
      summary
    });
  }

  if (input.thinking) {
    await createSectionWithBlock(mrpId, "thinking", "Thinking", 4, "thinking", { text: input.thinking }, {
      collapsedByDefault: true,
      selectable: true,
      contextDefault: "exclude",
      summary: input.thinking.split(/\s+/).slice(0, 24).join(" ")
    });
  }

  if (input.usage) {
    await createSectionWithBlock(mrpId, "usage", "Usage", 8, "usage", { usage: input.usage }, {
      collapsedByDefault: true,
      selectable: false,
      contextDefault: "exclude",
      summary: `${input.usage.totalTokens ?? "unknown"} total tokens`
    });
  }

  await appendMrpEvent(mrpId, undefined, "turn_completed", {
    finishReason: input.finishReason,
    responseCharacters: response.length,
    thinkingCharacters: input.thinking?.length ?? 0,
    usage: input.usage
  });

  const [mrp] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  if (!mrp) throw new Error(`MRP ${mrpId} was not found after completion`);
  return toMrp(mrp);
}

export async function appendMrpEvent(
  mrpId: string,
  modelRunId: string | undefined,
  type: string,
  payload: Record<string, unknown>
): Promise<MrpEvent> {
  const [sequenceRow] = await db
    .select({ value: max(mrpEvents.sequence) })
    .from(mrpEvents)
    .where(eq(mrpEvents.mrpId, mrpId));
  const event: MrpEvent = {
    id: id(),
    mrpId,
    ...(modelRunId ? { modelRunId } : {}),
    type,
    sequence: (sequenceRow?.value ?? 0) + 1,
    payload,
    createdAt: now()
  };
  await db.insert(mrpEvents).values(event);
  return event;
}

interface SectionOptions {
  collapsedByDefault: boolean;
  selectable: boolean;
  contextDefault: "include" | "exclude" | "summarize";
  summary?: string;
  metadata?: Record<string, unknown>;
}

async function createSectionWithBlock(
  mrpId: string,
  sectionKind: MrpSectionKind,
  title: string,
  sectionSequence: number,
  blockKind: MrpBlockKind,
  content: Record<string, unknown>,
  options: SectionOptions
) {
  const timestamp = now();
  const section: MrpSection = {
    id: id(),
    mrpId,
    kind: sectionKind,
    title,
    ...(options.summary ? { summary: options.summary } : {}),
    sequence: sectionSequence,
    collapsedByDefault: options.collapsedByDefault,
    selectable: options.selectable,
    contextDefault: options.contextDefault,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const block: MrpBlock = {
    id: id(),
    mrpId,
    sectionId: section.id,
    kind: blockKind,
    sequence: 1,
    content,
    selectable: options.selectable,
    sourceEventIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.insert(mrpSections).values(section);
  await db.insert(mrpBlocks).values(block);
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

function toMrpSection(row: typeof mrpSections.$inferSelect): MrpSection {
  return {
    id: row.id,
    mrpId: row.mrpId,
    kind: row.kind,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    sequence: row.sequence,
    collapsedByDefault: row.collapsedByDefault,
    selectable: row.selectable,
    contextDefault: row.contextDefault,
    ...(row.metadata ? { metadata: row.metadata } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toMrpBlock(row: typeof mrpBlocks.$inferSelect): MrpBlock {
  return {
    id: row.id,
    mrpId: row.mrpId,
    sectionId: row.sectionId,
    kind: row.kind,
    sequence: row.sequence,
    content: row.content,
    selectable: row.selectable,
    ...(row.tokenEstimate ? { tokenEstimate: row.tokenEstimate } : {}),
    sourceEventIds: row.sourceEventIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toMrpEvent(row: typeof mrpEvents.$inferSelect): MrpEvent {
  return {
    id: row.id,
    mrpId: row.mrpId,
    ...(row.modelRunId ? { modelRunId: row.modelRunId } : {}),
    type: row.type,
    sequence: row.sequence,
    payload: row.payload,
    createdAt: row.createdAt
  };
}
