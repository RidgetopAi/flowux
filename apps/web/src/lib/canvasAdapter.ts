import type {
  Artifact,
  CanvasPlacement,
  CanvasSnapshot,
  ModelRun,
  Mrp,
  MrpEvent,
  MrpStatus as ServerMrpStatus,
  StateSnapshot
} from "@flowux/shared";
import type {
  CanvasObject,
  ImageObject,
  MRPObject,
  MRPStatus,
  StateObject,
  ToolCallObject,
  ToolCallStatus
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

// Tool-call chip dimensions and stacking math. Chips stack vertically to
// the right of the issuing MRP; if an image already occupies that slot,
// the stack starts below the image with an extra gap.
const TOOL_CHIP_W = 240;
const TOOL_CHIP_H = 28;
const TOOL_CHIP_GAP = 4;
const TOOL_ANCHOR_GAP = 24;
// Cap visible tool-call nodes per MRP. With more than this, the last
// chip collapses into a "+N more" indicator (handled in the renderer).
const TOOL_MAX_VISIBLE = 6;

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

  // Group tool-call events per MRP and fold each toolCall.id into a single
  // ToolCallObject (status comes from the latest event; args come from the
  // started event when present). Pi events store proper tool names + args
  // in mrp_events.payload — the persisted block snapshot loses this data,
  // so we drive directly off events here.
  const toolCallsByMrpId = collectToolCalls(snapshot.events ?? []);

  const objects: CanvasObject[] = [];

  for (const placement of snapshot.placements) {
    const mrp = mrpById.get(placement.mrpId);
    if (!mrp) continue;
    objects.push(
      toMRPObject(placement, mrp, runByMrpId.get(mrp.id), branchOutCountByMrpId.get(mrp.id)),
    );
  }

  /* State snapshots — only the ACTIVE snapshot renders as a canvas card
   *  (a single tidy amber tile). Superseded snapshots stay in the DB for
   *  the future history view rather than stacking up on the board. */
  const activeSnapshotId = snapshot.canvas.activeSnapshotId;
  for (const stateSnap of snapshot.stateSnapshots ?? []) {
    if (stateSnap.id !== activeSnapshotId) continue;
    objects.push(toStateObject(stateSnap, true));
  }

  // Track per-placement whether an image already occupies the right slot
  // so tool-call stacking can offset below it without overlapping.
  const hasImageByPlacementId = new Set<string>();
  for (const artifact of snapshot.artifacts) {
    if (artifact.type !== "image") continue;
    const anchor = snapshot.placements.find((p) => p.mrpId === artifact.mrpId);
    if (!anchor) continue;
    objects.push(toImageObject(artifact, anchor));
    hasImageByPlacementId.add(anchor.id);
  }

  // Tool-call chips — stacked vertically right of each MRP, below the
  // image if one is present. Cap at TOOL_MAX_VISIBLE per MRP.
  for (const placement of snapshot.placements) {
    const calls = toolCallsByMrpId.get(placement.mrpId);
    if (!calls || calls.length === 0) continue;
    const stackTopY = hasImageByPlacementId.has(placement.id)
      ? placement.y + IMAGE_DEFAULT_H + TOOL_CHIP_GAP * 3
      : placement.y;
    const visible = calls.slice(0, TOOL_MAX_VISIBLE);
    const overflowCount = Math.max(0, calls.length - TOOL_MAX_VISIBLE);
    visible.forEach((call, i) => {
      objects.push(toToolCallObject(call, placement, stackTopY, i));
    });
    if (overflowCount > 0) {
      objects.push({
        type: "tool_call",
        id: `tool-${placement.id}-overflow`,
        x: placement.x + 320 + TOOL_ANCHOR_GAP,
        y: stackTopY + visible.length * (TOOL_CHIP_H + TOOL_CHIP_GAP),
        width: TOOL_CHIP_W,
        height: TOOL_CHIP_H,
        checked: false,
        name: `+${overflowCount} more`,
        status: "complete",
        anchoredToId: placement.id,
      });
    }
  }

  return objects;
}

interface CollectedToolCall {
  id: string;
  name: string;
  argsSummary?: string;
  status: ToolCallStatus;
  mrpId: string;
  firstSeen: number;
}

/** Fold raw mrp_events into one entry per unique toolCall.id, preserving
 *  encounter order. tool_call_started seeds name + args; later events
 *  (delta / completed / error) update status — but only when their toolCall.id
 *  is real (Pi sometimes emits generic placeholder events with id
 *  "tool-unknown" that we ignore). */
function collectToolCalls(events: MrpEvent[]): Map<string, CollectedToolCall[]> {
  const perMrp = new Map<string, Map<string, CollectedToolCall>>();
  let counter = 0;
  for (const ev of events) {
    if (!ev.type.startsWith("tool_call_")) continue;
    const payload = ev.payload as { toolCall?: { id?: string; name?: string; args?: unknown; status?: string } };
    const tc = payload.toolCall;
    if (!tc?.id || tc.id === "tool-unknown") continue;
    const perMrpMap = perMrp.get(ev.mrpId) ?? new Map<string, CollectedToolCall>();
    const existing = perMrpMap.get(tc.id);
    const status = mapToolStatus(tc.status, ev.type, existing?.status);
    if (existing) {
      // Only update status; preserve original name/args from the started event.
      existing.status = status;
    } else {
      perMrpMap.set(tc.id, {
        id: tc.id,
        name: tc.name ?? "tool",
        argsSummary: formatArgs(tc.args),
        status,
        mrpId: ev.mrpId,
        firstSeen: counter++,
      });
    }
    perMrp.set(ev.mrpId, perMrpMap);
  }
  // Flatten each MRP's map into an array sorted by firstSeen.
  const out = new Map<string, CollectedToolCall[]>();
  for (const [mrpId, m] of perMrp) {
    out.set(mrpId, [...m.values()].sort((a, b) => a.firstSeen - b.firstSeen));
  }
  return out;
}

function mapToolStatus(
  rawStatus: string | undefined,
  evType: string,
  prev?: ToolCallStatus,
): ToolCallStatus {
  if (evType === "tool_call_completed") {
    return rawStatus === "error" ? "error" : "complete";
  }
  if (evType === "tool_call_delta") return "streaming";
  if (evType === "tool_call_started") return "started";
  return prev ?? "started";
}

function formatArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  // One-line k=v summary, trimmed. Booleans/numbers print bare; strings
  // get quoted; objects collapse to `{…}` so the chip stays one line.
  const parts = entries.slice(0, 3).map(([k, v]) => {
    let val: string;
    if (typeof v === "string") val = `"${v.length > 32 ? v.slice(0, 32) + "…" : v}"`;
    else if (typeof v === "number" || typeof v === "boolean") val = String(v);
    else val = "{…}";
    return `${k}=${val}`;
  });
  return parts.join(" ");
}

function toToolCallObject(
  call: CollectedToolCall,
  anchor: CanvasPlacement,
  stackTopY: number,
  stackIndex: number,
): ToolCallObject {
  return {
    type: "tool_call",
    id: `tool-${call.id}`,
    x: anchor.x + 320 + TOOL_ANCHOR_GAP,
    y: stackTopY + stackIndex * (TOOL_CHIP_H + TOOL_CHIP_GAP),
    width: TOOL_CHIP_W,
    height: TOOL_CHIP_H,
    checked: false,
    name: call.name,
    argsSummary: call.argsSummary,
    status: call.status,
    anchoredToId: anchor.id,
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
    compactedAtSeq: mrp.compactedAtSeq
  };
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
