import { and, desc, eq, inArray, max, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  buildContextMessages,
  type Branch,
  type CanvasPlacement,
  type CanvasSnapshot,
  type CanvasThread,
  type ContextMode,
  type ContextBundle,
  type CreateChildCanvasResponse,
  type CreatePromptResponse,
  type ImportExternalMrpsResponse,
  type ModelRun,
  type Mrp,
  type MrpBlock,
  type MrpBlockKind,
  type MrpEvent,
  type MrpSection,
  type MrpSectionKind
} from "@flowux/shared";
import { db } from "../db/client.js";
import {
  branches,
  canvasPlacements,
  canvasThreads,
  contextBundles,
  artifacts,
  modelRuns,
  mrpBlocks,
  mrpEvents,
  mrps,
  mrpSections
} from "../db/schema.js";
import { createHarnessAdapter } from "../harness/index.js";
import type { TokenUsage } from "../model/adapter.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CARD_WIDTH = 360;
const CARD_HEIGHT = 240;
const GAP_X = 18;
const GAP_Y = 10;
const MARGIN = 56;

const now = () => new Date().toISOString();
const id = () => randomUUID();

export async function listCanvases(): Promise<CanvasThread[]> {
  const rows = await db.select().from(canvasThreads).orderBy(desc(canvasThreads.updatedAt));
  return rows.map(toCanvasThread);
}

export async function createCanvas(title = "Untitled Flowux Canvas"): Promise<CanvasThread> {
  const timestamp = now();
  const canvas: CanvasThread = {
    id: id(),
    title: title.trim() || "Untitled Flowux Canvas",
    status: "temporary",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString()
  };
  await db.insert(canvasThreads).values(canvas);
  return canvas;
}

export async function updateCanvasTitle(canvasId: string, title: string): Promise<CanvasThread | undefined> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error("title_required");

  await db
    .update(canvasThreads)
    .set({ title: trimmedTitle, updatedAt: now() })
    .where(eq(canvasThreads.id, canvasId));

  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  return canvas ? toCanvasThread(canvas) : undefined;
}

export async function deleteCanvas(canvasId: string): Promise<{ deletedCanvasId: string }> {
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) throw new Error("canvas_not_found");

  const nativeMrps = await db.select().from(mrps).where(eq(mrps.canvasId, canvasId));
  const nativeMrpIds = nativeMrps.map((mrp) => mrp.id);
  const externallyReferencedPlacements = nativeMrpIds.length
    ? await db
        .select()
        .from(canvasPlacements)
        .where(and(inArray(canvasPlacements.mrpId, nativeMrpIds), ne(canvasPlacements.canvasId, canvasId)))
    : [];
  const externallyReferencedMrpIds = new Set(externallyReferencedPlacements.map((placement) => placement.mrpId));
  const removableMrpIds = nativeMrpIds.filter((mrpId) => !externallyReferencedMrpIds.has(mrpId));

  await db.delete(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  await db.delete(contextBundles).where(eq(contextBundles.canvasId, canvasId));
  await db.delete(branches).where(eq(branches.parentCanvasId, canvasId));
  await db.delete(branches).where(eq(branches.childCanvasId, canvasId));

  if (removableMrpIds.length) {
    await db.delete(artifacts).where(inArray(artifacts.mrpId, removableMrpIds));
    await db.delete(modelRuns).where(inArray(modelRuns.mrpId, removableMrpIds));
    await db.delete(mrpEvents).where(inArray(mrpEvents.mrpId, removableMrpIds));
    await db.delete(mrpBlocks).where(inArray(mrpBlocks.mrpId, removableMrpIds));
    await db.delete(mrpSections).where(inArray(mrpSections.mrpId, removableMrpIds));
    await db.delete(mrps).where(inArray(mrps.id, removableMrpIds));
  }

  await db.delete(canvasThreads).where(eq(canvasThreads.id, canvasId));

  return { deletedCanvasId: canvasId };
}

export async function getCanvasSnapshot(canvasId: string): Promise<CanvasSnapshot | undefined> {
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) return undefined;

  const placements = await db
    .select()
    .from(canvasPlacements)
    .where(eq(canvasPlacements.canvasId, canvasId));
  const placementMrpIds = placements.map((placement) => placement.mrpId);
  const nativeMrps = await db.select().from(mrps).where(eq(mrps.canvasId, canvasId)).orderBy(mrps.sequence);
  const nativeMrpIds = nativeMrps.map((mrp) => mrp.id);
  const mrpIds = Array.from(new Set([...nativeMrpIds, ...placementMrpIds]));
  const snapshotMrps = mrpIds.length
    ? await db.select().from(mrps).where(inArray(mrps.id, mrpIds)).orderBy(mrps.sequence)
    : [];
  const sections = mrpIds.length
    ? await db.select().from(mrpSections).where(inArray(mrpSections.mrpId, mrpIds)).orderBy(mrpSections.sequence)
    : [];
  const blocks = mrpIds.length
    ? await db.select().from(mrpBlocks).where(inArray(mrpBlocks.mrpId, mrpIds)).orderBy(mrpBlocks.sequence)
    : [];
  const events = mrpIds.length
    ? await db.select().from(mrpEvents).where(inArray(mrpEvents.mrpId, mrpIds)).orderBy(mrpEvents.sequence)
    : [];
  const runs = mrpIds.length ? await db.select().from(modelRuns).where(inArray(modelRuns.mrpId, mrpIds)) : [];
  const branchRows = await db
    .select()
    .from(branches)
    .where(eq(branches.parentCanvasId, canvasId));
  const parentBranchRows = await db
    .select()
    .from(branches)
    .where(eq(branches.childCanvasId, canvasId));
  const bundleRows = await db.select().from(contextBundles).where(eq(contextBundles.canvasId, canvasId));

  return {
    canvas: toCanvasThread(canvas),
    mrps: snapshotMrps.map(toMrp),
    placements: placements.map(toPlacement),
    modelRuns: runs.map(toModelRun),
    sections: sections.map(toMrpSection),
    blocks: blocks.map(toMrpBlock),
    events: events.map(toMrpEvent),
    branches: [...branchRows, ...parentBranchRows].map(toBranch),
    contextBundles: bundleRows.map(toContextBundle)
  };
}

export async function createChildCanvasFromSelection(parentCanvasId: string): Promise<CreateChildCanvasResponse> {
  const timestamp = now();
  const [parentCanvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, parentCanvasId));
  if (!parentCanvas) throw new Error("parent_canvas_not_found");

  const selectedPlacements = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, parentCanvasId), eq(canvasPlacements.selectedForContext, true)));
  if (!selectedPlacements.length) throw new Error("selected_mrps_required");

  const selectedMrpIds = selectedPlacements.map((placement) => placement.mrpId);
  const selectedMrps = await db.select().from(mrps).where(inArray(mrps.id, selectedMrpIds)).orderBy(mrps.sequence);
  const selectedById = new Map(selectedMrps.map((mrp) => [mrp.id, mrp]));
  const orderedMrpIds = selectedMrpIds
    .filter((mrpId) => selectedById.has(mrpId))
    .sort((a, b) => (selectedById.get(a)?.sequence ?? 0) - (selectedById.get(b)?.sequence ?? 0));
  if (!orderedMrpIds.length) throw new Error("selected_mrps_not_found");

  const branchId = id();
  const childCanvas: CanvasThread = {
    id: id(),
    title: `${parentCanvas.title} Branch`,
    status: "temporary",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    parentCanvasId,
    parentBranchId: branchId,
    summary: `${orderedMrpIds.length} source MRP${orderedMrpIds.length === 1 ? "" : "s"}`
  };
  const branch: Branch = {
    id: branchId,
    parentCanvasId,
    childCanvasId: childCanvas.id,
    sourceMrpIds: orderedMrpIds,
    createdAt: timestamp,
    label: childCanvas.title
  };
  const childPlacements: CanvasPlacement[] = orderedMrpIds.map((mrpId, index) => {
    const sourceMrp = selectedById.get(mrpId);
    const position = getChronologicalPosition(index + 1, {});
    return {
      id: id(),
      canvasId: childCanvas.id,
      mrpId,
      originCanvasId: sourceMrp?.canvasId ?? parentCanvasId,
      isExternalReference: true,
      x: position.x,
      y: position.y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      collapsed: false,
      selectedForContext: true,
      connectionHidden: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });

  await db.insert(canvasThreads).values(childCanvas);
  await db.insert(branches).values(branch);
  await db.insert(canvasPlacements).values(childPlacements);
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, parentCanvasId));

  return { canvas: childCanvas, branch, placements: childPlacements };
}

export async function importExternalMrps(
  canvasId: string,
  mrpIds: string[],
  layout: LayoutMetrics = {}
): Promise<ImportExternalMrpsResponse> {
  const timestamp = now();
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) throw new Error("canvas_not_found");

  const requestedIds = Array.from(new Set(mrpIds.filter(Boolean)));
  if (!requestedIds.length) throw new Error("mrp_ids_required");

  const sourceMrps = await db.select().from(mrps).where(inArray(mrps.id, requestedIds)).orderBy(mrps.sequence);
  if (!sourceMrps.length) throw new Error("source_mrps_not_found");

  const existingPlacements = await db.select().from(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  const existingMrpIds = new Set(existingPlacements.map((placement) => placement.mrpId));
  const importableMrps = sourceMrps.filter((mrp) => mrp.canvasId !== canvasId && !existingMrpIds.has(mrp.id));
  if (!importableMrps.length) throw new Error("no_importable_mrps");

  const orderedExistingPlacements = orderPlacementsByMrpSequence(existingPlacements.map(toPlacement), []);
  let previousPlacement = orderedExistingPlacements.at(-1);
  const placements: CanvasPlacement[] = importableMrps.map((mrp, index) => {
    const position = previousPlacement
      ? getNextPromptPosition(previousPlacement, layout)
      : getChronologicalPosition(index + 1, layout);
    const placement: CanvasPlacement = {
      id: id(),
      canvasId,
      mrpId: mrp.id,
      originCanvasId: mrp.canvasId,
      isExternalReference: true,
      x: position.x,
      y: position.y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      collapsed: false,
      selectedForContext: false,
      connectionHidden: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    previousPlacement = placement;
    return placement;
  });

  await db.insert(canvasPlacements).values(placements);
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  return { placements };
}

export async function saveContextBundleFromSelection(canvasId: string, name?: string): Promise<ContextBundle> {
  const timestamp = now();
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) throw new Error("canvas_not_found");

  const placements = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.selectedForContext, true)));
  if (!placements.length) throw new Error("selected_mrps_required");

  const selectedMrpIds = placements.map((placement) => placement.mrpId);
  const selectedMrps = await db.select().from(mrps).where(inArray(mrps.id, selectedMrpIds)).orderBy(mrps.sequence);
  const selectedById = new Map(selectedMrps.map((mrp) => [mrp.id, mrp]));
  const orderedMrpIds = selectedMrpIds
    .filter((mrpId) => selectedById.has(mrpId))
    .sort((a, b) => (selectedById.get(a)?.sequence ?? 0) - (selectedById.get(b)?.sequence ?? 0));
  if (!orderedMrpIds.length) throw new Error("selected_mrps_not_found");

  const bundle: ContextBundle = {
    id: id(),
    canvasId,
    name: name?.trim() || `Context set ${new Date(timestamp).toLocaleString("en-US", { month: "short", day: "numeric" })}`,
    selectedMrpIds: orderedMrpIds,
    modeByMrpId: Object.fromEntries(orderedMrpIds.map((mrpId) => [mrpId, "full_mrp" as ContextMode])),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.insert(contextBundles).values(bundle);
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  return bundle;
}

export async function applyContextBundle(canvasId: string, bundleId: string): Promise<CanvasPlacement[]> {
  const timestamp = now();
  const [bundle] = await db
    .select()
    .from(contextBundles)
    .where(and(eq(contextBundles.canvasId, canvasId), eq(contextBundles.id, bundleId)));
  if (!bundle) throw new Error("context_bundle_not_found");

  const selectedMrpIds = bundle.selectedMrpIds;
  await db
    .update(canvasPlacements)
    .set({ selectedForContext: false, updatedAt: timestamp })
    .where(eq(canvasPlacements.canvasId, canvasId));

  if (selectedMrpIds.length) {
    await db
      .update(canvasPlacements)
      .set({ selectedForContext: true, updatedAt: timestamp })
      .where(and(eq(canvasPlacements.canvasId, canvasId), inArray(canvasPlacements.mrpId, selectedMrpIds)));
  }

  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  const placements = await db.select().from(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  return placements.map(toPlacement);
}

export async function deleteContextBundle(canvasId: string, bundleId: string): Promise<{ deletedBundleId: string }> {
  const [bundle] = await db
    .select()
    .from(contextBundles)
    .where(and(eq(contextBundles.canvasId, canvasId), eq(contextBundles.id, bundleId)));
  if (!bundle) throw new Error("context_bundle_not_found");

  await db.delete(contextBundles).where(and(eq(contextBundles.canvasId, canvasId), eq(contextBundles.id, bundleId)));
  await db.update(canvasThreads).set({ updatedAt: now() }).where(eq(canvasThreads.id, canvasId));

  return { deletedBundleId: bundleId };
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

export async function updateCanvasSelection(canvasId: string, selectedForContext: boolean): Promise<CanvasPlacement[]> {
  const timestamp = now();
  await db
    .update(canvasPlacements)
    .set({ selectedForContext, updatedAt: timestamp })
    .where(eq(canvasPlacements.canvasId, canvasId));
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  const placements = await db.select().from(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  return placements.map(toPlacement);
}

interface LayoutMetrics {
  layoutWidth?: number;
  layoutLeft?: number;
  layoutTop?: number;
  rowHeight?: number;
}

export async function snapBack(
  canvasId: string,
  layoutWidth = 1260,
  rowHeight = 600,
  layoutLeft = 0,
  layoutTop = 0
): Promise<CanvasPlacement[]> {
  const currentPlacements = await db.select().from(canvasPlacements).where(eq(canvasPlacements.canvasId, canvasId));
  const currentMrpIds = currentPlacements.map((placement) => placement.mrpId);
  const canvasMrps = currentMrpIds.length
    ? await db.select().from(mrps).where(inArray(mrps.id, currentMrpIds)).orderBy(mrps.sequence)
    : [];
  const orderedPlacements = orderPlacementsByMrpSequence(currentPlacements.map(toPlacement), canvasMrps.map(toMrp), canvasId);
  const timestamp = now();
  let previousPlacement: CanvasPlacement | undefined;

  for (const [index, currentPlacement] of orderedPlacements.entries()) {
    const position = previousPlacement
      ? getNextPromptPosition(previousPlacement, { layoutWidth, rowHeight, layoutLeft, layoutTop })
      : getChronologicalPosition(index + 1, { layoutWidth, rowHeight, layoutLeft, layoutTop });
    await db
      .update(canvasPlacements)
      .set({
        x: position.x,
        y: position.y,
        updatedAt: timestamp
      })
      .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, currentPlacement.mrpId)));
    previousPlacement = {
      ...currentPlacement,
      x: position.x,
      y: position.y,
      width: currentPlacement?.width ?? CARD_WIDTH,
      height: currentPlacement?.height ?? CARD_HEIGHT
    };
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

  const previousPlacement = await getPreviousPlacement(canvasId, maxSequence);
  const position = previousPlacement
    ? getNextPromptPosition(previousPlacement, layout)
    : getChronologicalPosition(sequence, layout);
  const placement: CanvasPlacement = {
    id: id(),
    canvasId,
    mrpId: mrp.id,
    originCanvasId: undefined,
    isExternalReference: false,
    x: position.x,
    y: position.y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
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

  const adapter = createHarnessAdapter();
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
    harnessMode: adapter.mode,
    capabilities: adapter.capabilities,
    inputMrpIds
  });
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));

  return { mrp, placement, modelRun };
}

function getChronologicalPosition(sequence: number, layout: LayoutMetrics) {
  const rowHeight = layout.rowHeight ?? 600;
  const layoutWidth = layout.layoutWidth ?? 1260;
  const layoutLeft = layout.layoutLeft ?? 0;
  const layoutTop = layout.layoutTop ?? 0;
  const safeRowHeight = Math.max(360, Math.min(1200, rowHeight));
  const usableWidth = Math.max(CARD_WIDTH, layoutWidth - MARGIN * 2);
  const columns = Math.max(1, Math.floor((usableWidth + GAP_X) / (CARD_WIDTH + GAP_X)));
  const index = sequence - 1;

  return {
    x: layoutLeft + MARGIN + (index % columns) * (CARD_WIDTH + GAP_X),
    y: layoutTop + MARGIN + Math.floor(index / columns) * (safeRowHeight + GAP_Y)
  };
}

function orderPlacementsByMrpSequence(placements: CanvasPlacement[], relatedMrps: Mrp[], nativeCanvasId?: string) {
  const mrpById = new Map(relatedMrps.map((mrp) => [mrp.id, mrp]));
  return [...placements].sort((a, b) => {
    const mrpA = mrpById.get(a.mrpId);
    const mrpB = mrpById.get(b.mrpId);
    const nativeRankA = nativeCanvasId && mrpA?.canvasId === nativeCanvasId ? 0 : 1;
    const nativeRankB = nativeCanvasId && mrpB?.canvasId === nativeCanvasId ? 0 : 1;
    if (nativeRankA !== nativeRankB) return nativeRankA - nativeRankB;
    const sequenceA = mrpA?.sequence ?? Number.MAX_SAFE_INTEGER;
    const sequenceB = mrpB?.sequence ?? Number.MAX_SAFE_INTEGER;
    if (sequenceA !== sequenceB) return sequenceA - sequenceB;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

async function getPreviousPlacement(canvasId: string, previousSequence: number): Promise<CanvasPlacement | undefined> {
  if (previousSequence < 1) return undefined;
  const [previousMrp] = await db
    .select()
    .from(mrps)
    .where(and(eq(mrps.canvasId, canvasId), eq(mrps.sequence, previousSequence)));
  if (!previousMrp) return undefined;

  const [placement] = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, previousMrp.id)));

  return placement ? toPlacement(placement) : undefined;
}

function getNextPromptPosition(previous: CanvasPlacement, layout: LayoutMetrics) {
  const rowHeight = layout.rowHeight ?? 600;
  const layoutWidth = layout.layoutWidth ?? 1260;
  const layoutLeft = layout.layoutLeft ?? 0;
  const layoutTop = layout.layoutTop ?? 0;
  const safeRowHeight = Math.max(360, Math.min(1200, rowHeight));
  const visibleRight = layoutLeft + layoutWidth - MARGIN;
  const nextX = previous.x + previous.width + GAP_X;

  if (nextX + CARD_WIDTH <= visibleRight) {
    return { x: nextX, y: previous.y };
  }

  return {
    x: layoutLeft + MARGIN,
    y: Math.max(previous.y + safeRowHeight + GAP_Y, layoutTop + MARGIN)
  };
}

export interface CompletePromptInput {
  response: string;
  thinking?: string;
  usage?: TokenUsage;
  finishReason?: string;
  toolCalls?: Array<Record<string, unknown>>;
  toolResults?: Array<Record<string, unknown>>;
  rawEvents?: Array<Record<string, unknown>>;
}

export async function completePromptMrp(canvasId: string, mrpId: string, input: CompletePromptInput): Promise<Mrp> {
  const timestamp = now();
  const response = input.response;
  const [existingMrp] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  const [existingRun] = await db.select().from(modelRuns).where(eq(modelRuns.mrpId, mrpId));
  const timingMs = existingRun ? Math.max(0, Date.parse(timestamp) - Date.parse(existingRun.startedAt)) : undefined;
  const summary = deriveMrpSummary(response, existingMrp?.userPrompt ?? "");
  const title = deriveMrpTitle(existingMrp?.userPrompt ?? "", response);
  const runMetadata = {
    responseCharacters: response.length,
    thinkingCharacters: input.thinking?.length ?? 0,
    toolCallEvents: input.toolCalls?.length ?? 0,
    toolResultEvents: input.toolResults?.length ?? 0,
    rawEvents: input.rawEvents?.length ?? 0
  };
  await db
    .update(mrps)
    .set({
      assistantResponse: response,
      title,
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
      timingMs,
      finishReason: input.finishReason,
      metadata: runMetadata
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

  if (input.toolCalls?.length) {
    await createSectionWithBlock(mrpId, "tool_calls", "Tool Calls", 5, "tool_call", { toolCalls: input.toolCalls }, {
      collapsedByDefault: true,
      selectable: true,
      contextDefault: "summarize",
      summary: `${input.toolCalls.length} tool event${input.toolCalls.length === 1 ? "" : "s"}`
    });
  }

  if (input.toolResults?.length) {
    await createSectionWithBlock(mrpId, "tool_results", "Tool Results", 6, "tool_result", { toolResults: input.toolResults }, {
      collapsedByDefault: true,
      selectable: true,
      contextDefault: "summarize",
      summary: `${input.toolResults.length} tool result event${input.toolResults.length === 1 ? "" : "s"}`
    });
  }

  if (input.usage) {
    await createSectionWithBlock(mrpId, "usage", "Run", 8, "usage", { usage: input.usage, timingMs, finishReason: input.finishReason, metadata: runMetadata }, {
      collapsedByDefault: true,
      selectable: false,
      contextDefault: "exclude",
      summary: formatRunSummary(input.usage.totalTokens, timingMs, input.finishReason)
    });
  }

  if (input.rawEvents?.length) {
    await createSectionWithBlock(mrpId, "raw_events", "Raw Events", 9, "event", { events: input.rawEvents }, {
      collapsedByDefault: true,
      selectable: false,
      contextDefault: "exclude",
      summary: `${input.rawEvents.length} raw event${input.rawEvents.length === 1 ? "" : "s"}`
    });
  }

  await appendMrpEvent(mrpId, undefined, "turn_completed", {
    finishReason: input.finishReason,
    responseCharacters: response.length,
    thinkingCharacters: input.thinking?.length ?? 0,
    usage: input.usage,
    toolCallEvents: input.toolCalls?.length ?? 0,
    toolResultEvents: input.toolResults?.length ?? 0,
    rawEvents: input.rawEvents?.length ?? 0
  });

  const [mrp] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  if (!mrp) throw new Error(`MRP ${mrpId} was not found after completion`);
  return toMrp(mrp);
}

export async function failPromptMrp(canvasId: string, mrpId: string, message: string): Promise<Mrp> {
  const timestamp = now();
  const [existingMrp] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  const [existingRun] = await db.select().from(modelRuns).where(eq(modelRuns.mrpId, mrpId));
  const timingMs = existingRun ? Math.max(0, Date.parse(timestamp) - Date.parse(existingRun.startedAt)) : undefined;
  const summary = truncateAtWord(normalizeSnippet(message) || "Model run failed.", 180);

  await db
    .update(mrps)
    .set({
      title: deriveMrpTitle(existingMrp?.userPrompt ?? "", message),
      summary,
      status: "error",
      updatedAt: timestamp
    })
    .where(and(eq(mrps.canvasId, canvasId), eq(mrps.id, mrpId)));

  await db
    .update(modelRuns)
    .set({
      completedAt: timestamp,
      timingMs,
      finishReason: "error",
      error: message,
      metadata: { errorMessage: message }
    })
    .where(eq(modelRuns.mrpId, mrpId));

  await createSectionWithBlock(mrpId, "errors", "Errors", 7, "error", { message, timingMs }, {
    collapsedByDefault: false,
    selectable: false,
    contextDefault: "exclude",
    summary
  });
  await appendMrpEvent(mrpId, existingRun?.id, "turn_completed", {
    finishReason: "error",
    error: message,
    timingMs
  });

  const [mrp] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  if (!mrp) throw new Error(`MRP ${mrpId} was not found after failure`);
  return toMrp(mrp);
}

function deriveMrpTitle(prompt: string, response: string) {
  const promptSnippet = normalizeSnippet(prompt);
  const responseSnippet = normalizeSnippet(response);
  const source = isInstructionPrompt(promptSnippet) ? responseSnippet || promptSnippet : promptSnippet || responseSnippet || "Untitled MRP";
  const withoutLeadIn = source
    .replace(/^(can you|could you|please|tell me|show me|give me|reply with|write|say|use mandrel and)\s+/i, "")
    .replace(/^(what is|what are|how do|how does|why does|why is)\s+/i, "")
    .trim();
  return truncateAtWord(withoutLeadIn || source, 58);
}

function isInstructionPrompt(value: string) {
  return /^(reply with|write|say)\b/i.test(value);
}

function deriveMrpSummary(response: string, prompt: string) {
  const source = normalizeSnippet(response) || normalizeSnippet(prompt) || "No response captured.";
  const firstSentence = source.match(/^(.{24,220}?[.!?])(\s|$)/)?.[1];
  return truncateAtWord(firstSentence ?? source, 180);
}

function normalizeSnippet(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[#>*_`[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength + 1);
  const trimmed = sliced.slice(0, Math.max(0, sliced.lastIndexOf(" "))).trim();
  return `${trimmed || value.slice(0, maxLength).trim()}...`;
}

function formatRunSummary(totalTokens?: number, timingMs?: number, finishReason?: string) {
  const parts = [
    totalTokens ? `${totalTokens.toLocaleString()} tokens` : "tokens unknown",
    timingMs ? `${(timingMs / 1000).toFixed(1)}s` : undefined,
    finishReason
  ].filter(Boolean);
  return parts.join(" · ");
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
  const placements = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.selectedForContext, true)));
  const selectedMrpIds = placements.map((placement) => placement.mrpId);
  const canvasMrps = selectedMrpIds.length
    ? await db.select().from(mrps).where(inArray(mrps.id, selectedMrpIds)).orderBy(mrps.sequence)
    : [];

  return buildContextMessages({
    mrps: canvasMrps.map(toMrp).filter((mrp) => mrp.status === "complete"),
    selectedMrpIds,
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

function toModelRun(row: typeof modelRuns.$inferSelect): ModelRun {
  return {
    id: row.id,
    canvasId: row.canvasId,
    mrpId: row.mrpId,
    provider: row.provider,
    model: row.model,
    inputMrpIds: row.inputMrpIds,
    ...(row.promptTokens ? { promptTokens: row.promptTokens } : {}),
    ...(row.completionTokens ? { completionTokens: row.completionTokens } : {}),
    ...(row.totalTokens ? { totalTokens: row.totalTokens } : {}),
    ...(row.timingMs ? { timingMs: row.timingMs } : {}),
    ...(row.finishReason ? { finishReason: row.finishReason } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
    startedAt: row.startedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.error ? { error: row.error } : {})
  };
}

function toBranch(row: typeof branches.$inferSelect): Branch {
  return {
    id: row.id,
    parentCanvasId: row.parentCanvasId,
    childCanvasId: row.childCanvasId,
    sourceMrpIds: row.sourceMrpIds,
    createdAt: row.createdAt,
    ...(row.label ? { label: row.label } : {})
  };
}

function toContextBundle(row: typeof contextBundles.$inferSelect): ContextBundle {
  return {
    id: row.id,
    canvasId: row.canvasId,
    ...(row.name ? { name: row.name } : {}),
    selectedMrpIds: row.selectedMrpIds,
    modeByMrpId: row.modeByMrpId as Record<string, ContextMode>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
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
