import { useCanvas, filterMRPs, type MRP } from "../../lib/store";
import { Connector } from "../primitives/Connector";

/**
 * Renders connector lines between parent → child MRPs.
 *
 * parentId is MRP-specific (other object variants don't have a "branched
 * from" relationship), so we filter the canvas objects down to MRPs here
 * before building the pair list.
 *
 * Visual differentiation:
 *   - Cyan SOLID line   = same-canvas branch (e.g. an internal fork that
 *                         landed back as an MRP on this canvas — rare but
 *                         honest when it happens).
 *   - Violet DASHED line = cross-canvas branch (parent or child is an
 *                          external reference). The dashed style + violet
 *                          tone read as "linked from elsewhere" at a glance.
 *
 * Anchoring picks the dominant axis between the two card centers and
 * attaches to the appropriate edges. Tile heights are uniform
 * (--mrp-canvas-h = 240px) so the math is exact.
 */
export function ConnectionLayer() {
  const objects = useCanvas((s) => s.objects);
  const draggingId = useCanvas((s) => s.draggingId);

  const mrps = filterMRPs(objects);
  const byId = new Map(mrps.map((m) => [m.id, m]));

  const pairs: Array<{ parent: MRP; child: MRP }> = [];
  for (const child of mrps) {
    if (!child.parentId) continue;
    const parent = byId.get(child.parentId);
    if (parent) pairs.push({ parent, child });
  }

  return (
    <>
      {pairs.map(({ parent, child }) => {
        const { from, to } = computeAnchors(parent, child);
        const dim = draggingId === parent.id || draggingId === child.id;
        const isCrossCanvas = !!(child.external || parent.external);
        return (
          <Connector
            key={`${parent.id}->${child.id}`}
            from={from}
            to={to}
            tone={isCrossCanvas ? "violet" : "cyan"}
            curve="bezier"
            animate={!dim && isCrossCanvas}
            dashed={isCrossCanvas}
            width={isCrossCanvas ? 1.4 : 1.8}
          />
        );
      })}
    </>
  );
}

function computeAnchors(parent: MRP, child: MRP) {
  // Heights are now exact (every MRP has a height field — uniform 240
  // canvas tile). No estimate needed.
  const ph = parent.height;
  const ch = child.height;
  const px = parent.x + parent.width / 2;
  const py = parent.y + ph / 2;
  const cx = child.x + child.width / 2;
  const cy = child.y + ch / 2;
  const dx = cx - px;
  const dy = cy - py;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal-dominant
    return dx > 0
      ? {
          from: { x: parent.x + parent.width, y: parent.y + ph / 2 },
          to:   { x: child.x,                  y: child.y  + ch / 2 },
        }
      : {
          from: { x: parent.x,                 y: parent.y + ph / 2 },
          to:   { x: child.x + child.width,    y: child.y  + ch / 2 },
        };
  } else {
    // Vertical-dominant
    return dy > 0
      ? {
          from: { x: parent.x + parent.width / 2, y: parent.y + ph },
          to:   { x: child.x  + child.width  / 2, y: child.y },
        }
      : {
          from: { x: parent.x + parent.width / 2, y: parent.y },
          to:   { x: child.x  + child.width  / 2, y: child.y  + ch },
        };
  }
}
