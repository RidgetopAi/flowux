import { and, desc, eq, inArray, max, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  buildContextMessages,
  estimateContextBudget,
  normalizeStateDocument,
  type Branch,
  type CanvasImage,
  type CanvasPlacement,
  type CanvasSnapshot,
  type CanvasThread,
  type ContextMode,
  type ContextBundle,
  type ContextBudget,
  type CreateChildCanvasResponse,
  type CreatePromptResponse,
  type ImportExternalMrpsResponse,
  type ModelRun,
  type Mrp,
  type MrpBlock,
  type MrpDetails,
  type MrpBlockKind,
  type MrpEvent,
  type MrpSection,
  type MrpSectionKind,
  type SearchResponse,
  type UploadedAttachment
} from "@flowux/shared";
import type {
  CompactCanvasResponse,
  StateDocument,
  StateSnapshotTrigger
} from "@flowux/shared";
import { db } from "../db/client.js";
import { createHarnessAdapter } from "../harness/index.js";
import {
  branches,
  canvasImages,
  canvasPlacements,
  canvasThreads,
  contextBundles,
  artifacts,
  modelRuns,
  mrpBlocks,
  mrpEvents,
  mrps,
  mrpSections,
  stateSnapshots
} from "../db/schema.js";
import type { StateSnapshot } from "@flowux/shared";
import type { TokenUsage } from "../model/adapter.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CARD_WIDTH = 360;
const CARD_HEIGHT = 240;
const GAP_X = 18;
const GAP_Y = 10;
const MARGIN = 56;

const now = () => new Date().toISOString();
const id = () => randomUUID();

interface SnapshotOptions {
  summaryOnly?: boolean;
}

export async function listCanvases(): Promise<CanvasThread[]> {
  await pruneExpiredTemporaryCanvases();
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

export async function updateCanvasStatus(canvasId: string, status: "temporary" | "saved"): Promise<CanvasThread | undefined> {
  const timestamp = now();
  await db
    .update(canvasThreads)
    .set({
      status,
      expiresAt: status === "temporary" ? new Date(Date.now() + 30 * DAY_MS).toISOString() : null,
      updatedAt: timestamp
    })
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
  await db.delete(canvasImages).where(eq(canvasImages.canvasId, canvasId));
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

async function pruneExpiredTemporaryCanvases() {
  const timestamp = now();
  const expired = await db.select().from(canvasThreads).where(eq(canvasThreads.status, "temporary"));
  for (const canvas of expired) {
    if (!canvas.expiresAt || canvas.expiresAt > timestamp) continue;
    await deleteCanvas(canvas.id);
  }
}

export async function getCanvasSnapshot(canvasId: string, options: SnapshotOptions = {}): Promise<CanvasSnapshot | undefined> {
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
  const blocks =
    mrpIds.length && !options.summaryOnly
      ? await db.select().from(mrpBlocks).where(inArray(mrpBlocks.mrpId, mrpIds)).orderBy(mrpBlocks.sequence)
      : [];
  // Events are heavy (one canvas can carry 1000+), so summary mode normally
  // skips them. We DO want tool_call_started + tool_call_completed even in
  // summary mode so the canvas adapter can project tool-call chip nodes
  // without an N+1 fetch per MRP. tool_result_completed feeds the
  // ExpandedMRP "Files Touched" section — included here with the heavy
  // result.content text stripped (full text is still on the row in DB
  // and reachable via getMrpDetails). Delta events are pure transport noise
  // — same identity is already covered by started/completed — so we drop
  // them to keep the payload tight.
  const events = mrpIds.length
    ? options.summaryOnly
      ? (
          await db
            .select()
            .from(mrpEvents)
            .where(
              and(
                inArray(mrpEvents.mrpId, mrpIds),
                inArray(mrpEvents.type, [
                  "tool_call_started",
                  "tool_call_completed",
                  "tool_result_completed",
                ]),
              ),
            )
            .orderBy(mrpEvents.sequence)
        ).map(slimSummaryEventRow)
      : await db.select().from(mrpEvents).where(inArray(mrpEvents.mrpId, mrpIds)).orderBy(mrpEvents.sequence)
    : [];
  const runs = mrpIds.length ? await db.select().from(modelRuns).where(inArray(modelRuns.mrpId, mrpIds)) : [];
  const artifactRows = mrpIds.length ? await db.select().from(artifacts).where(inArray(artifacts.mrpId, mrpIds)) : [];
  const branchRows = await db
    .select()
    .from(branches)
    .where(eq(branches.parentCanvasId, canvasId));
  const parentBranchRows = await db
    .select()
    .from(branches)
    .where(eq(branches.childCanvasId, canvasId));
  const bundleRows = await db.select().from(contextBundles).where(eq(contextBundles.canvasId, canvasId));
  const canvasImageRows = await db.select().from(canvasImages).where(eq(canvasImages.canvasId, canvasId));
  const snapshotRows = await db
    .select()
    .from(stateSnapshots)
    .where(eq(stateSnapshots.canvasId, canvasId))
    .orderBy(stateSnapshots.version);

  return {
    canvas: toCanvasThread(canvas),
    mrps: snapshotMrps.map(toMrp),
    placements: placements.map(toPlacement),
    modelRuns: runs.map(toModelRun),
    sections: sections.map(toMrpSection),
    blocks: blocks.map(toMrpBlock),
    events: events.map(toMrpEvent),
    artifacts: artifactRows.map(toArtifact),
    canvasImages: canvasImageRows.map(toCanvasImage),
    branches: [...branchRows, ...parentBranchRows].map(toBranch),
    contextBundles: bundleRows.map(toContextBundle),
    stateSnapshots: snapshotRows.map(toStateSnapshot)
  };
}

export async function getMrpDetails(canvasId: string, mrpId: string): Promise<MrpDetails | undefined> {
  const [placement] = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.mrpId, mrpId)));
  if (!placement) return undefined;

  const runs = await db.select().from(modelRuns).where(eq(modelRuns.mrpId, mrpId));
  const sections = await db.select().from(mrpSections).where(eq(mrpSections.mrpId, mrpId)).orderBy(mrpSections.sequence);
  const blocks = await db.select().from(mrpBlocks).where(eq(mrpBlocks.mrpId, mrpId)).orderBy(mrpBlocks.sequence);
  const events = await db.select().from(mrpEvents).where(eq(mrpEvents.mrpId, mrpId)).orderBy(mrpEvents.sequence);
  const artifactRows = await db.select().from(artifacts).where(eq(artifacts.mrpId, mrpId));

  return {
    mrpId,
    modelRuns: runs.map(toModelRun),
    sections: sections.map(toMrpSection),
    blocks: blocks.map(toMrpBlock),
    events: events.map(toMrpEvent),
    artifacts: artifactRows.map(toArtifact)
  };
}

export async function searchWorkspace(query: string, limit = 30): Promise<SearchResponse> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { query: "", results: [] };

  const canvasRows = await db.select().from(canvasThreads).orderBy(desc(canvasThreads.updatedAt));
  const mrpRows = await db.select().from(mrps).orderBy(desc(mrps.updatedAt));
  const artifactRows = await db.select().from(artifacts).orderBy(desc(artifacts.createdAt));
  const mrpById = new Map(mrpRows.map((mrp) => [mrp.id, mrp]));

  const results = [
    ...canvasRows.flatMap((canvas) => {
      const haystack = [canvas.title, canvas.summary, canvas.status].filter(Boolean).join("\n");
      return matchesQuery(haystack, normalized)
        ? [
            {
              id: canvas.id,
              kind: "canvas" as const,
              canvasId: canvas.id,
              title: canvas.title,
              snippet: makeSnippet(haystack, normalized),
              updatedAt: canvas.updatedAt
            }
          ]
        : [];
    }),
    ...mrpRows.flatMap((mrp) => {
      const haystack = [mrp.title, mrp.summary, mrp.userPrompt, mrp.assistantResponse].filter(Boolean).join("\n");
      return matchesQuery(haystack, normalized)
        ? [
            {
              id: mrp.id,
              kind: "mrp" as const,
              canvasId: mrp.canvasId,
              mrpId: mrp.id,
              title: mrp.title || `MRP ${mrp.sequence}`,
              snippet: makeSnippet(haystack, normalized),
              updatedAt: mrp.updatedAt
            }
          ]
        : [];
    }),
    ...artifactRows.flatMap((artifact) => {
      const sourceMrp = mrpById.get(artifact.mrpId);
      if (!sourceMrp) return [];
      const haystack = [artifact.name, artifact.uri, artifact.mimeType, JSON.stringify(artifact.metadata ?? {})].filter(Boolean).join("\n");
      return matchesQuery(haystack, normalized)
        ? [
            {
              id: artifact.id,
              kind: "artifact" as const,
              canvasId: sourceMrp.canvasId,
              mrpId: artifact.mrpId,
              title: artifact.name,
              snippet: makeSnippet(haystack, normalized),
              updatedAt: artifact.createdAt
            }
          ]
        : [];
    })
  ];

  return {
    query,
    results: results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit)
  };
}

export async function createChildCanvasFromSelection(
  parentCanvasId: string,
  explicitSourceMrpIds?: string[],
): Promise<CreateChildCanvasResponse> {
  const timestamp = now();
  const [parentCanvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, parentCanvasId));
  if (!parentCanvas) throw new Error("parent_canvas_not_found");

  let selectedMrpIds: string[];
  if (explicitSourceMrpIds && explicitSourceMrpIds.length > 0) {
    // Caller-supplied MRP ids — validate they belong to this canvas before forking.
    const placements = await db
      .select()
      .from(canvasPlacements)
      .where(and(eq(canvasPlacements.canvasId, parentCanvasId), inArray(canvasPlacements.mrpId, explicitSourceMrpIds)));
    if (!placements.length) throw new Error("selected_mrps_required");
    selectedMrpIds = placements.map((placement) => placement.mrpId);
  } else {
    // Fallback to the canvas's currently-checked placements (used by the sidebar
    // Branch button which doesn't ship explicit ids).
    const selectedPlacements = await db
      .select()
      .from(canvasPlacements)
      .where(and(eq(canvasPlacements.canvasId, parentCanvasId), eq(canvasPlacements.selectedForContext, true)));
    if (!selectedPlacements.length) throw new Error("selected_mrps_required");
    selectedMrpIds = selectedPlacements.map((placement) => placement.mrpId);
  }

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

/* ── Canvas images (parked, free-floating) ─────────────────────────────── */

const CANVAS_IMAGE_DEFAULT_W = 240;
const CANVAS_IMAGE_DEFAULT_H = 240;

export interface CreateCanvasImageInput {
  uploadId: string;
  uri: string;
  name: string;
  mimeType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export async function createCanvasImage(canvasId: string, input: CreateCanvasImageInput): Promise<CanvasImage> {
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) throw new Error("canvas_not_found");

  const timestamp = now();
  const row = {
    id: id(),
    canvasId,
    uploadId: input.uploadId,
    uri: input.uri,
    name: input.name,
    mimeType: input.mimeType ?? null,
    naturalWidth: input.naturalWidth ?? null,
    naturalHeight: input.naturalHeight ?? null,
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.round(input.width ?? CANVAS_IMAGE_DEFAULT_W),
    height: Math.round(input.height ?? CANVAS_IMAGE_DEFAULT_H),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await db.insert(canvasImages).values(row);
  await db.update(canvasThreads).set({ updatedAt: timestamp }).where(eq(canvasThreads.id, canvasId));
  return toCanvasImage(row);
}

export async function updateCanvasImage(
  canvasId: string,
  imageId: string,
  patch: Partial<Pick<CanvasImage, "x" | "y" | "width" | "height">>
): Promise<CanvasImage | undefined> {
  const rounded: Record<string, number> = {};
  for (const key of ["x", "y", "width", "height"] as const) {
    if (patch[key] !== undefined) rounded[key] = Math.round(patch[key] as number);
  }
  await db
    .update(canvasImages)
    .set({ ...rounded, updatedAt: now() })
    .where(and(eq(canvasImages.canvasId, canvasId), eq(canvasImages.id, imageId)));

  const [row] = await db
    .select()
    .from(canvasImages)
    .where(and(eq(canvasImages.canvasId, canvasId), eq(canvasImages.id, imageId)));
  return row ? toCanvasImage(row) : undefined;
}

export async function deleteCanvasImage(canvasId: string, imageId: string): Promise<{ deletedImageId: string }> {
  const [row] = await db
    .select()
    .from(canvasImages)
    .where(and(eq(canvasImages.canvasId, canvasId), eq(canvasImages.id, imageId)));
  if (!row) throw new Error("canvas_image_not_found");

  await db.delete(canvasImages).where(and(eq(canvasImages.canvasId, canvasId), eq(canvasImages.id, imageId)));
  await db.update(canvasThreads).set({ updatedAt: now() }).where(eq(canvasThreads.id, canvasId));
  return { deletedImageId: imageId };
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
  layout: LayoutMetrics = {},
  attachments: UploadedAttachment[] = [],
  contextBudget?: ContextBudget
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

  const inputMrpIds = await getPromptContextMrpIds(canvasId);

  const adapter = createHarnessAdapter(canvasId);
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
  if (attachments.length) {
    const artifactValues = attachments.map((attachment) => ({
      id: id(),
      mrpId: mrp.id,
      type: attachment.type,
      name: attachment.name,
      uri: attachment.uri,
      mimeType: attachment.mimeType,
      metadata: {
        uploadId: attachment.id,
        size: attachment.size,
        textPreview: attachment.textPreview
      },
      createdAt: timestamp
    }));
    await db.insert(artifacts).values(artifactValues);
    await createSectionWithBlock(
      mrp.id,
      "artifacts",
      "Attachments",
      2,
      "artifact",
      { attachments },
      {
        collapsedByDefault: false,
        selectable: true,
        contextDefault: "include",
        summary: `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`
      }
    );
  }
  await createSectionWithBlock(
    mrp.id,
    "context_sent",
    "Context Sent",
    attachments.length ? 3 : 2,
    "event",
    { inputMrpIds, mode: "full_mrp", ordering: "canonical_sequence" },
    {
      collapsedByDefault: true,
      selectable: true,
      contextDefault: "exclude",
      summary: `${inputMrpIds.length} selected MRP${inputMrpIds.length === 1 ? "" : "s"} · ${contextBudget?.estimatedTokens.toLocaleString() ?? "?"} est tokens`
    }
  );
  await appendMrpEvent(mrp.id, modelRun.id, "turn_started", {
    provider: modelRun.provider,
    model: modelRun.model,
    harnessMode: adapter.mode,
    capabilities: adapter.capabilities,
    inputMrpIds,
    contextBudget
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
  const contextMrpIds = await getPromptContextMrpIds(canvasId);
  const canvasMrps = contextMrpIds.length
    ? await db.select().from(mrps).where(inArray(mrps.id, contextMrpIds)).orderBy(mrps.sequence)
    : [];

  /* Load the active state snapshot (if compaction has been done on this
   *  canvas) so buildContextMessages can render it as the prelude that
   *  replaces compacted turns. Also pull in pinned MRP ids so they're
   *  exempt from compaction filtering and workingSetSize truncation. */
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  let stateSnapshot: ReturnType<typeof toStateSnapshot> | undefined;
  if (canvas?.activeSnapshotId) {
    const [row] = await db.select().from(stateSnapshots).where(eq(stateSnapshots.id, canvas.activeSnapshotId));
    if (row) stateSnapshot = toStateSnapshot(row);
  }
  const pinnedMrpIds = canvasMrps.filter((m) => m.pinned).map((m) => m.id);

  return buildContextMessages({
    mrps: canvasMrps.map(toMrp).filter((mrp) => mrp.status === "complete"),
    selectedMrpIds: contextMrpIds,
    systemPrompt: "You are Flowux, a spatial AI workspace assistant. Preserve project reasoning and answer concisely.",
    currentPrompt: prompt,
    ...(stateSnapshot ? { stateSnapshot } : {}),
    ...(pinnedMrpIds.length ? { pinnedMrpIds } : {}),
    ...(canvas?.workingSetSize ? { workingSetSize: canvas.workingSetSize } : {})
  });
}

export async function buildPromptContextBudget(
  canvasId: string,
  prompt: string,
  contextWindow: number,
  maxOutputTokens: number
): Promise<ContextBudget> {
  const messages = await buildMessagesForPrompt(canvasId, prompt);
  return estimateContextBudget({ messages, contextWindow, maxOutputTokens, currentPrompt: prompt });
}

async function getPromptContextMrpIds(canvasId: string) {
  const nativeCompletedMrps = await db
    .select()
    .from(mrps)
    .where(and(eq(mrps.canvasId, canvasId), eq(mrps.status, "complete")))
    .orderBy(mrps.sequence);
  const selectedPlacements = await db
    .select()
    .from(canvasPlacements)
    .where(and(eq(canvasPlacements.canvasId, canvasId), eq(canvasPlacements.selectedForContext, true)));

  return Array.from(new Set([...nativeCompletedMrps.map((mrp) => mrp.id), ...selectedPlacements.map((placement) => placement.mrpId)]));
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
    ...(row.modelConfigId ? { modelConfigId: row.modelConfigId } : {}),
    ...(row.activeSnapshotId ? { activeSnapshotId: row.activeSnapshotId } : {}),
    ...(row.workingSetSize !== null && row.workingSetSize !== undefined ? { workingSetSize: row.workingSetSize } : {}),
    ...(row.autoCompactThreshold !== null && row.autoCompactThreshold !== undefined ? { autoCompactThreshold: row.autoCompactThreshold } : {})
  };
}

function toStateSnapshot(row: typeof stateSnapshots.$inferSelect): StateSnapshot {
  return {
    id: row.id,
    canvasId: row.canvasId,
    version: row.version,
    ...(row.parentSnapshotId ? { parentSnapshotId: row.parentSnapshotId } : {}),
    /* Coerce older snapshots (pre nextStep/constraints/rejected) into the
     *  full shape so the UI and renderer can rely on every field. */
    state: normalizeStateDocument(row.state as Partial<StateDocument>),
    generatedBy: row.generatedBy,
    generatedAt: row.generatedAt,
    triggeredBy: row.triggeredBy,
    coveredMrpIds: row.coveredMrpIds,
    coveredFromSeq: row.coveredFromSeq,
    coveredToSeq: row.coveredToSeq,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    editedByUser: row.editedByUser,
    ...(row.editHistory ? { editHistory: row.editHistory } : {})
  };
}

function matchesQuery(value: string, normalizedQuery: string) {
  return value.toLowerCase().includes(normalizedQuery);
}

function makeSnippet(value: string, normalizedQuery: string) {
  const normalizedValue = value.toLowerCase();
  const index = normalizedValue.indexOf(normalizedQuery);
  const start = Math.max(0, index - 80);
  const end = Math.min(value.length, (index < 0 ? 0 : index) + normalizedQuery.length + 120);
  return truncateAtWord(value.slice(start, end).replace(/\s+/g, " ").trim(), 220);
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
    ...(row.modelRunId ? { modelRunId: row.modelRunId } : {}),
    ...(row.pinned ? { pinned: true } : {}),
    ...(row.compactedBySnapshotId ? { compactedBySnapshotId: row.compactedBySnapshotId } : {}),
    ...(row.compactedAtSeq !== null && row.compactedAtSeq !== undefined ? { compactedAtSeq: row.compactedAtSeq } : {})
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

function toCanvasImage(row: typeof canvasImages.$inferSelect): CanvasImage {
  return {
    id: row.id,
    canvasId: row.canvasId,
    uploadId: row.uploadId,
    uri: row.uri,
    name: row.name,
    ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    ...(row.naturalWidth !== null && row.naturalWidth !== undefined ? { naturalWidth: row.naturalWidth } : {}),
    ...(row.naturalHeight !== null && row.naturalHeight !== undefined ? { naturalHeight: row.naturalHeight } : {}),
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toArtifact(row: typeof artifacts.$inferSelect) {
  return {
    id: row.id,
    mrpId: row.mrpId,
    type: row.type,
    name: row.name,
    uri: row.uri,
    ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
    createdAt: row.createdAt
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

const SUMMARY_RESULT_PREVIEW_CHARS = 240;

/** Trim heavy fields off summary-mode event rows before they ride along
 *  in the canvas snapshot. tool_result_completed payloads carry the full
 *  text of every Read/Bash/etc. result — a single canvas can push the
 *  snapshot well past 1 MB if we ship them raw. We keep only what the
 *  Files Touched section + future inline previews need:
 *    toolCallId, toolName, isError, result.details (already small),
 *    and a short preview of the text content.
 *  Full text is still on the row in DB and reachable via getMrpDetails.
 *  Returns the row shape so the standard `toMrpEvent` mapping still runs. */
type MrpEventRow = typeof mrpEvents.$inferSelect;
function slimSummaryEventRow(row: MrpEventRow): MrpEventRow {
  if (row.type !== "tool_result_completed") return row;
  const payload = row.payload as {
    toolResult?: {
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
      result?: {
        content?: Array<{ type?: string; text?: string }>;
        details?: unknown;
      };
    };
  };
  const tr = payload.toolResult;
  if (!tr) return row;
  const firstText = tr.result?.content?.find((c) => c?.type === "text")?.text ?? "";
  const preview =
    firstText.length > SUMMARY_RESULT_PREVIEW_CHARS
      ? firstText.slice(0, SUMMARY_RESULT_PREVIEW_CHARS) + "…"
      : firstText;
  const slimmed: Record<string, unknown> = {
    toolResult: {
      ...(tr.toolCallId ? { toolCallId: tr.toolCallId } : {}),
      ...(tr.toolName ? { toolName: tr.toolName } : {}),
      ...(typeof tr.isError === "boolean" ? { isError: tr.isError } : {}),
      result: {
        ...(preview ? { contentPreview: preview } : {}),
        ...(tr.result?.details !== undefined ? { details: tr.result.details } : {}),
      },
    },
  };
  return { ...row, payload: slimmed };
}

/* ── Compaction ───────────────────────────────────────────────────────
 * Generates a new state snapshot covering a range of MRPs, persists it,
 * marks the covered MRPs, and updates the canvas's activeSnapshotId.
 * Used by /compact slash command, future auto-trigger, and bundle-scoped
 * compaction. */

const STATE_CARD_WIDTH = 320;
const STATE_CARD_HEIGHT = 240;
const STATE_CARD_GAP_Y = 280;
const SNAPSHOT_RETRY_LIMIT = 1;

const SNAPSHOT_SYSTEM_PROMPT = `You are maintaining the canonical STATE for an ongoing technical conversation between a developer (the user) and an AI assistant. This is NOT a summary of what happened — it is the operating context a fresh agent would need to resume the work correctly WITHOUT the original transcript.

Write for the next agent. The bar you must clear: given ONLY your state document (no transcript), could someone correctly answer — what is the goal, what is the single next action, what must not be changed, what has been decided and why, what has been ruled out, and which facts are solid versus still assumptions?

You will receive:
1. The PREVIOUS state snapshot (as JSON), or "(none)" if this is the first compaction.
2. NEW raw conversation turns to fold into the state.

Produce an UPDATED state document that:
- Carries forward what is still true from the prior snapshot; updates what changed.
- Marks goals "done" or "blocked" when the new turns show that.
- Names the single most useful NEXT STEP.
- Preserves the WHY behind every decision — reasoning is load-bearing; without it the next agent re-litigates settled choices.
- Records approaches that were tried or considered and ruled out, and why, so they are not blindly re-attempted.
- Captures hard user requirements / non-negotiables as constraints, kept as close to the user's exact wording as possible.
- Preserves brittle, exact tokens VERBATIM — error messages, file paths, commands, API/schema names, exact user quotes. Never paraphrase these.
- Distinguishes established facts ("known") from guesses ("assumed") and things still to confirm ("needs_verification").
- Captures concise, durable signal — not chronological narration. Omit social filler and abandoned tangents, EXCEPT where a dead end is itself load-bearing negative knowledge (record it under "rejected").
- Drops nothing that would change the next action.

Output STRICTLY valid JSON matching this schema:

{
  "summary": "1-2 sentence statement of where the work stands now",
  "nextStep": "the single most useful next action (empty string if there genuinely is none)",
  "goals": [
    { "text": "...", "status": "active" | "blocked" | "done", "since": "<iso date>" }
  ],
  "constraints": [
    { "text": "a hard requirement / non-negotiable, verbatim where possible",
      "source": "(optional) mrp-id" }
  ],
  "decisions": [
    { "what": "the choice that was made", "why": "the reasoning behind it",
      "mrpId": "(optional) source MRP id", "at": "<iso date>" }
  ],
  "facts": [
    { "text": "the fact, with any exact tokens preserved verbatim",
      "confidence": "known" | "assumed" | "needs_verification",
      "sources": ["(optional) mrp-id", ...] }
  ],
  "rejected": [
    { "approach": "what was tried or considered", "why": "why it was ruled out",
      "mrpId": "(optional) source MRP id" }
  ],
  "artifacts": [
    { "kind": "file" | "url" | "concept" | "other",
      "identifier": "path / url / name",
      "role": "what this is in the conversation" }
  ],
  "openQuestions": [
    { "text": "...", "raisedBy": "(optional) mrp-id" }
  ]
}

Rules:
- Output ONLY the JSON object. No markdown code fences. No prose before or after.
- Every array must be present (use [] if empty).
- "summary" is required and non-empty. "nextStep" is always present (use "" if genuinely none).
- "facts" default to "known" if you omit confidence — so set "assumed" or "needs_verification" explicitly when warranted.
- ISO dates are full ISO-8601 strings.`;

export async function compactCanvas(
  canvasId: string,
  opts: { mrpIds?: string[]; trigger?: StateSnapshotTrigger } = {}
): Promise<CompactCanvasResponse> {
  const [canvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  if (!canvas) throw new Error("canvas_not_found");

  const activeSnapshotRow = canvas.activeSnapshotId
    ? (await db.select().from(stateSnapshots).where(eq(stateSnapshots.id, canvas.activeSnapshotId)))[0]
    : undefined;

  const allCompleted = await db
    .select()
    .from(mrps)
    .where(and(eq(mrps.canvasId, canvasId), eq(mrps.status, "complete")))
    .orderBy(mrps.sequence);

  const workingSize = canvas.workingSetSize ?? 8;

  /* Resolve the target MRPs. Scoped (opts.mrpIds provided) = exactly
   *  those, minus pinned/already-compacted. Unscoped = everything past
   *  the prior snapshot's covered range up to (latest − workingSetSize),
   *  minus pinned. */
  let targets: typeof allCompleted;
  if (opts.mrpIds && opts.mrpIds.length) {
    const wanted = new Set(opts.mrpIds);
    targets = allCompleted.filter(
      (m) => wanted.has(m.id) && !m.pinned && !m.compactedBySnapshotId
    );
  } else {
    const priorEnd = activeSnapshotRow?.coveredToSeq ?? -1;
    const candidates = allCompleted.filter((m) => m.sequence > priorEnd && !m.compactedBySnapshotId);
    const cutoff = Math.max(0, candidates.length - workingSize);
    targets = candidates.slice(0, cutoff).filter((m) => !m.pinned);
  }

  if (targets.length === 0) {
    throw new Error("nothing_to_compact");
  }

  /* Generate the new state document via the active harness model. */
  const adapter = createHarnessAdapter(canvasId);
  const newState = await generateStateDocument(
    adapter,
    activeSnapshotRow ? (activeSnapshotRow.state as StateDocument) : undefined,
    targets.map(toMrp)
  );

  /* Pick a spatial placement for the STATE card. Park it above the
   *  topmost covered MRP placement so the spatial flow reads:
   *  STATE card → compacted (muted) MRPs → recent verbatim MRPs. */
  const targetIds = targets.map((m) => m.id);
  const targetPlacements = targetIds.length
    ? await db
        .select()
        .from(canvasPlacements)
        .where(and(eq(canvasPlacements.canvasId, canvasId), inArray(canvasPlacements.mrpId, targetIds)))
    : [];
  const minX = targetPlacements.length ? Math.min(...targetPlacements.map((p) => p.x)) : 0;
  const minY = targetPlacements.length ? Math.min(...targetPlacements.map((p) => p.y)) : 0;

  const snapshotId = id();
  const timestamp = now();
  const newVersion = (activeSnapshotRow?.version ?? 0) + 1;
  const coveredFromSeq = activeSnapshotRow?.coveredFromSeq ?? targets[0]!.sequence;
  const coveredToSeq = targets[targets.length - 1]!.sequence;
  const coveredMrpIds = [
    ...(activeSnapshotRow?.coveredMrpIds ?? []),
    ...targetIds
  ];

  const insertRow: typeof stateSnapshots.$inferInsert = {
    id: snapshotId,
    canvasId,
    version: newVersion,
    parentSnapshotId: activeSnapshotRow?.id ?? null,
    state: newState,
    generatedBy: `${adapter.provider}/${adapter.model}`,
    generatedAt: timestamp,
    triggeredBy: opts.trigger ?? "user",
    coveredMrpIds,
    coveredFromSeq,
    coveredToSeq,
    x: minX,
    y: minY - STATE_CARD_GAP_Y,
    width: STATE_CARD_WIDTH,
    height: STATE_CARD_HEIGHT,
    editedByUser: false,
    editHistory: null
  };

  await db.insert(stateSnapshots).values(insertRow);
  await db
    .update(canvasThreads)
    .set({ activeSnapshotId: snapshotId, updatedAt: timestamp })
    .where(eq(canvasThreads.id, canvasId));
  for (const m of targets) {
    await db
      .update(mrps)
      .set({
        compactedBySnapshotId: snapshotId,
        compactedAtSeq: m.sequence,
        updatedAt: timestamp
      })
      .where(eq(mrps.id, m.id));
  }

  const [updatedCanvas] = await db.select().from(canvasThreads).where(eq(canvasThreads.id, canvasId));
  const [persistedSnapshot] = await db.select().from(stateSnapshots).where(eq(stateSnapshots.id, snapshotId));

  return {
    snapshot: toStateSnapshot(persistedSnapshot!),
    compactedMrpIds: targetIds,
    canvas: toCanvasThread(updatedCanvas!)
  };
}

export async function editStateSnapshot(
  canvasId: string,
  snapshotId: string,
  patch: Partial<StateDocument>
): Promise<import("@flowux/shared").StateSnapshot> {
  const [row] = await db.select().from(stateSnapshots).where(eq(stateSnapshots.id, snapshotId));
  if (!row) throw new Error("snapshot_not_found");
  if (row.canvasId !== canvasId) throw new Error("snapshot_canvas_mismatch");

  /* Merge surgically — only overwrite fields the caller provided so
   *  partial edits don't blow away whole sections. Arrays are wholesale
   *  replaced when present (caller is responsible for sending the full
   *  list). summary, if sent, must remain non-empty. */
  /* Normalize the stored doc first — snapshots written before the
   *  nextStep/constraints/rejected fields existed lack them. */
  const current = normalizeStateDocument(row.state as Partial<StateDocument>);
  if (patch.summary !== undefined && !patch.summary.trim()) {
    throw new Error("summary_required");
  }
  const merged: StateDocument = {
    summary: patch.summary ?? current.summary,
    nextStep: patch.nextStep ?? current.nextStep,
    goals: patch.goals ?? current.goals,
    constraints: patch.constraints ?? current.constraints,
    decisions: patch.decisions ?? current.decisions,
    facts: patch.facts ?? current.facts,
    rejected: patch.rejected ?? current.rejected,
    artifacts: patch.artifacts ?? current.artifacts,
    openQuestions: patch.openQuestions ?? current.openQuestions
  };

  const timestamp = now();
  const editEntries = Object.keys(patch);
  const nextHistory = [
    ...(row.editHistory ?? []),
    ...editEntries.map((fieldPath) => ({ at: timestamp, fieldPath }))
  ];

  await db
    .update(stateSnapshots)
    .set({ state: merged, editedByUser: true, editHistory: nextHistory })
    .where(eq(stateSnapshots.id, snapshotId));

  const [updated] = await db.select().from(stateSnapshots).where(eq(stateSnapshots.id, snapshotId));
  return toStateSnapshot(updated!);
}

export async function setMrpPinned(mrpId: string, pinned: boolean): Promise<Mrp> {
  const timestamp = now();
  await db.update(mrps).set({ pinned, updatedAt: timestamp }).where(eq(mrps.id, mrpId));
  const [row] = await db.select().from(mrps).where(eq(mrps.id, mrpId));
  if (!row) throw new Error("mrp_not_found");
  return toMrp(row);
}

/* ── Snapshot generation helpers ──────────────────────────────────── */

async function generateStateDocument(
  adapter: ReturnType<typeof createHarnessAdapter>,
  priorState: StateDocument | undefined,
  newTurns: Mrp[]
): Promise<StateDocument> {
  const priorJson = priorState ? JSON.stringify(priorState, null, 2) : "(none)";
  const turnsBlock = newTurns
    .map(
      (m) =>
        `Turn ${m.sequence} [${m.id}]:\nUSER: ${m.userPrompt}\nASSISTANT: ${m.assistantResponse}`
    )
    .join("\n\n---\n\n");
  const basePrompt = `Previous state snapshot:\n${priorJson}\n\nNew raw turns:\n${turnsBlock}\n\nProduce the updated state document JSON now.`;

  let lastError: string | undefined;
  for (let attempt = 0; attempt <= SNAPSHOT_RETRY_LIMIT; attempt++) {
    const promptForAttempt = lastError
      ? `${basePrompt}\n\nIMPORTANT: your previous response failed to parse (${lastError}). Output ONLY the JSON object — no fences, no prose, no comments.`
      : basePrompt;
    try {
      const responseText = await runCompactionGeneration(adapter, SNAPSHOT_SYSTEM_PROMPT, promptForAttempt);
      return parseStateDocument(responseText);
    } catch (err) {
      /* Includes transient empty/error responses from the harness — retry
       *  rather than failing the whole compaction on a single bad turn. */
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`compaction_parse_failed: ${lastError ?? "unknown"}`);
}

async function runCompactionGeneration(
  adapter: ReturnType<typeof createHarnessAdapter>,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  /* Synthetic ids — the adapter doesn't persist anything itself; the
   *  server writes mrp_events from the event stream. Since we consume
   *  the stream here (not via the server's appendMrpEvent loop) these
   *  ids never touch the DB. */
  const syntheticCanvasId = "compaction";
  const syntheticMrpId = `compaction-mrp-${id()}`;
  const syntheticRunId = `compaction-run-${id()}`;
  let text = "";
  let errMsg: string | undefined;

  /* Some harness adapters (pi_mono) strip system-role messages before
   *  prompting, so the schema instructions must also ride along in the
   *  prompt itself. Adapters that honor system messages (direct_model)
   *  read from `messages` and ignore the duplicated `prompt`. */
  for await (const event of adapter.generate({
    messages: [{ role: "system", content: systemPrompt }],
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    canvasId: syntheticCanvasId,
    mrpId: syntheticMrpId,
    modelRunId: syntheticRunId
  })) {
    if (event.type === "response_delta") text += event.text;
    if (event.type === "error") {
      errMsg = event.message;
      break;
    }
    if (event.type === "done") break;
  }
  if (errMsg) throw new Error(errMsg);
  if (!text.trim()) throw new Error("empty_compaction_response");
  return text;
}

function parseStateDocument(raw: string): StateDocument {
  let s = raw.trim();
  /* Strip markdown fences defensively — the model is asked not to use
   *  them but small models sometimes do. */
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence?.[1]) s = fence[1].trim();
  /* Carve out the outermost JSON object — handles stray prose. */
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no_json_object");
  }
  s = s.slice(start, end + 1);
  const parsed = JSON.parse(s) as Record<string, unknown>;
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) throw new Error("missing_summary");

  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const obj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

  const goals = arr(parsed.goals)
    .map(obj)
    .filter((g): g is Record<string, unknown> => Boolean(g))
    .map((g) => ({
      text: str(g.text),
      status: (g.status === "blocked" || g.status === "done" ? g.status : "active") as
        | "active"
        | "blocked"
        | "done",
      since: str(g.since, new Date().toISOString())
    }))
    .filter((g) => g.text);

  const decisions = arr(parsed.decisions)
    .map(obj)
    .filter((d): d is Record<string, unknown> => Boolean(d))
    .map((d) => ({
      what: str(d.what),
      why: str(d.why),
      ...(typeof d.mrpId === "string" ? { mrpId: d.mrpId } : {}),
      at: str(d.at, new Date().toISOString())
    }))
    .filter((d) => d.what);

  const artifacts = arr(parsed.artifacts)
    .map(obj)
    .filter((a): a is Record<string, unknown> => Boolean(a))
    .map((a) => {
      const kind = a.kind === "file" || a.kind === "url" || a.kind === "concept" ? a.kind : "other";
      return {
        kind: kind as "file" | "url" | "concept" | "other",
        identifier: str(a.identifier),
        role: str(a.role)
      };
    })
    .filter((a) => a.identifier);

  const facts = arr(parsed.facts)
    .map(obj)
    .filter((f): f is Record<string, unknown> => Boolean(f))
    .map((f) => ({
      text: str(f.text),
      ...(f.confidence === "known" || f.confidence === "assumed" || f.confidence === "needs_verification"
        ? { confidence: f.confidence as "known" | "assumed" | "needs_verification" }
        : {}),
      ...(Array.isArray(f.sources) ? { sources: f.sources.filter((s): s is string => typeof s === "string") } : {})
    }))
    .filter((f) => f.text);

  const openQuestions = arr(parsed.openQuestions)
    .map(obj)
    .filter((q): q is Record<string, unknown> => Boolean(q))
    .map((q) => ({
      text: str(q.text),
      ...(typeof q.raisedBy === "string" ? { raisedBy: q.raisedBy } : {})
    }))
    .filter((q) => q.text);

  const nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim() : "";

  const constraints = arr(parsed.constraints)
    .map(obj)
    .filter((c): c is Record<string, unknown> => Boolean(c))
    .map((c) => ({
      text: str(c.text),
      ...(typeof c.source === "string" ? { source: c.source } : {})
    }))
    .filter((c) => c.text);

  const rejected = arr(parsed.rejected)
    .map(obj)
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => ({
      approach: str(r.approach),
      why: str(r.why),
      ...(typeof r.mrpId === "string" ? { mrpId: r.mrpId } : {})
    }))
    .filter((r) => r.approach);

  return { summary, nextStep, goals, constraints, decisions, facts, rejected, artifacts, openQuestions };
}
