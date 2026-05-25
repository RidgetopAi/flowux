import type {
  Artifact,
  CanvasPlacement,
  CanvasSnapshot,
  ModelRun,
  Mrp,
  MrpStatus as ServerMrpStatus
} from "@flowux/shared";
import type { CanvasObject, ImageObject, MRPObject, MRPStatus } from "./store";

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

  for (const artifact of snapshot.artifacts) {
    if (artifact.type !== "image") continue;
    const anchor = snapshot.placements.find((p) => p.mrpId === artifact.mrpId);
    if (!anchor) continue;
    objects.push(toImageObject(artifact, anchor));
  }

  return objects;
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
    branchOutCount: branchOutCount && branchOutCount > 0 ? branchOutCount : undefined
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
