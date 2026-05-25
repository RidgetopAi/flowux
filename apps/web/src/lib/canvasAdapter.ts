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

export function snapshotToCanvasObjects(snapshot: CanvasSnapshot): CanvasObject[] {
  const mrpById = new Map(snapshot.mrps.map((m) => [m.id, m]));
  const runByMrpId = new Map(snapshot.modelRuns.map((r) => [r.mrpId, r]));

  const objects: CanvasObject[] = [];

  for (const placement of snapshot.placements) {
    const mrp = mrpById.get(placement.mrpId);
    if (!mrp) continue;
    objects.push(toMRPObject(placement, mrp, runByMrpId.get(mrp.id)));
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
  modelRun: ModelRun | undefined
): MRPObject {
  return {
    type: "mrp",
    id: placement.id,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    checked: placement.selectedForContext,
    sequence: mrp.sequence,
    status: STATUS_MAP[mrp.status],
    prompt: mrp.userPrompt,
    response: mrp.assistantResponse,
    model: modelRun?.model ?? "unknown",
    tokens: modelRun?.totalTokens ?? 0,
    timestamp: mrp.createdAt,
    external: placement.isExternalReference ? true : undefined
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
