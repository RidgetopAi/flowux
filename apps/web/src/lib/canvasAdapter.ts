import type {
  Artifact,
  CanvasImage,
  CanvasPlacement,
  CanvasSnapshot,
  ModelRun,
  Mrp,
  MrpStatus as ServerMrpStatus,
  StateSnapshot
} from "@flowux/shared";
import type {
  CanvasObject,
  ImageObject,
  MRPObject,
  MRPStatus,
  StateObject
} from "./store";

const STATUS_MAP: Record<ServerMrpStatus, MRPStatus> = {
  pending: "pending",
  streaming: "active",
  complete: "complete",
  error: "error"
};

const IMAGE_ANCHOR_GAP = 24;
const IMAGE_DEFAULT_W = 240;
const IMAGE_DEFAULT_H = 240;

// Canvas tiles are uniform per the playground design system (tokens.css
// --mrp-canvas-w / --mrp-canvas-h). Persisted placement.width / .height
// came from the legacy custom workspace which used a different size and
// would otherwise overlap arrangeGrid's column math.
const MRP_TILE_W = 320;
const MRP_TILE_H = 240;

export function snapshotToCanvasObjects(snapshot: CanvasSnapshot): CanvasObject[] {
  const mrpById = new Map(snapshot.mrps.map((m) => [m.id, m]));
  const runByMrpId = new Map(snapshot.modelRuns.map((r) => [r.mrpId, r]));

  // Tally how many child canvases each MRP has seeded on THIS canvas. Used
  // to render the "branched" badge on MRP cards that were fork sources.
  const branchOutCountByMrpId = new Map<string, number>();
  for (const branch of snapshot.branches ?? []) {
    if (branch.parentCanvasId !== snapshot.canvas.id) continue;
    for (const mrpId of branch.sourceMrpIds) {
      branchOutCountByMrpId.set(mrpId, (branchOutCountByMrpId.get(mrpId) ?? 0) + 1);
    }
  }

  const objects: CanvasObject[] = [];

  for (const placement of snapshot.placements) {
    const mrp = mrpById.get(placement.mrpId);
    if (!mrp) continue;
    objects.push(
      toMRPObject(placement, mrp, runByMrpId.get(mrp.id), branchOutCountByMrpId.get(mrp.id)),
    );
  }

  /* State snapshots are NOT canvas tiles anymore — they're reached by
   *  clicking the COMPACTED chip on an MRP, which opens the snapshot that
   *  folded it in the STATE overlay. See snapshotToStateObjects (consumed by
   *  the canvas store's stateSnapshots lookup). */

  // Image artifacts anchored to the right of their MRP. (Tool calls are no
  // longer canvas nodes — they stream into the telemetry panel; see
  // lib/toolStream.ts + components/canvas/TelemetryPanel.tsx.)
  for (const artifact of snapshot.artifacts) {
    if (artifact.type !== "image") continue;
    const anchor = snapshot.placements.find((p) => p.mrpId === artifact.mrpId);
    if (!anchor) continue;
    objects.push(toImageObject(artifact, anchor));
  }

  // Parked images — free-floating, user-placed, persisted independently of any
  // MRP (the planning surface). Server-authoritative: they ride in
  // snapshot.canvasImages with their own x/y, so a reload restores the board.
  for (const canvasImage of snapshot.canvasImages ?? []) {
    objects.push(toCanvasImageObject(canvasImage));
  }

  return objects;
}

/** Stable canvas-object id prefix for parked images. The MovePersistHandler +
 *  delete affordance strip this to recover the canvas_images.id. */
export const CANVAS_IMAGE_ID_PREFIX = "canvasimage-";

export function toCanvasImageObject(canvasImage: CanvasImage): ImageObject {
  return {
    type: "image",
    id: `${CANVAS_IMAGE_ID_PREFIX}${canvasImage.id}`,
    x: canvasImage.x,
    y: canvasImage.y,
    width: canvasImage.width,
    height: canvasImage.height,
    checked: false,
    src: canvasImage.uri,
    alt: canvasImage.name,
    ...(canvasImage.naturalWidth !== undefined ? { naturalWidth: canvasImage.naturalWidth } : {}),
    ...(canvasImage.naturalHeight !== undefined ? { naturalHeight: canvasImage.naturalHeight } : {}),
    serverImageId: canvasImage.id,
    uploadId: canvasImage.uploadId
  };
}

export function toMRPObject(
  placement: CanvasPlacement,
  mrp: Mrp,
  modelRun: ModelRun | undefined,
  branchOutCount?: number
): MRPObject {
  return {
    type: "mrp",
    id: placement.id,
    x: placement.x,
    y: placement.y,
    width: MRP_TILE_W,
    height: MRP_TILE_H,
    checked: placement.selectedForContext,
    sequence: mrp.sequence,
    status: STATUS_MAP[mrp.status],
    prompt: mrp.userPrompt,
    response: mrp.assistantResponse,
    model: modelRun?.model ?? "unknown",
    tokens: modelRun?.totalTokens ?? 0,
    timestamp: mrp.createdAt,
    external: placement.isExternalReference ? true : undefined,
    branchOutCount: branchOutCount && branchOutCount > 0 ? branchOutCount : undefined,
    pinned: mrp.pinned ? true : undefined,
    compacted: mrp.compactedBySnapshotId ? true : undefined,
    compactedAtSeq: mrp.compactedAtSeq,
    compactedBySnapshotId: mrp.compactedBySnapshotId
  };
}

/** Build the STATE-overlay lookup: every snapshot on the canvas, keyed by its
 *  `state-${id}` canvas id. Unlike snapshotToCanvasObjects these are NOT
 *  rendered as tiles — a compacted MRP opens the one referenced by its
 *  compactedBySnapshotId. We expose ALL snapshots (not just the active one) so
 *  an MRP folded by a now-superseded version can still open the right state. */
export function snapshotToStateObjects(snapshot: CanvasSnapshot): StateObject[] {
  const activeSnapshotId = snapshot.canvas.activeSnapshotId;
  return (snapshot.stateSnapshots ?? []).map((stateSnap) =>
    toStateObject(stateSnap, stateSnap.id === activeSnapshotId),
  );
}

export function toStateObject(snapshot: StateSnapshot, active: boolean): StateObject {
  return {
    type: "state",
    id: `state-${snapshot.id}`,
    x: snapshot.x,
    y: snapshot.y,
    /* Force MRP tile size so STATE cards read as peers of MRP cards
     *  (older snapshots persisted a larger 480×320). */
    width: MRP_TILE_W,
    height: MRP_TILE_H,
    checked: false,
    snapshotId: snapshot.id,
    version: snapshot.version,
    coveredFromSeq: snapshot.coveredFromSeq,
    coveredToSeq: snapshot.coveredToSeq,
    coveredCount: snapshot.coveredMrpIds.length,
    state: snapshot.state,
    generatedBy: snapshot.generatedBy,
    generatedAt: snapshot.generatedAt,
    editedByUser: snapshot.editedByUser,
    active
  };
}

export function toImageObject(artifact: Artifact, anchor: CanvasPlacement): ImageObject {
  return {
    type: "image",
    id: `image-${artifact.id}`,
    x: anchor.x + anchor.width + IMAGE_ANCHOR_GAP,
    y: anchor.y,
    width: IMAGE_DEFAULT_W,
    height: IMAGE_DEFAULT_H,
    checked: false,
    src: artifact.uri,
    alt: artifact.name,
    anchoredToId: anchor.id
  };
}
