import { useCanvas } from "../../lib/store";
import "./Minimap.css";

/**
 * Birds-eye view of the canvas. Renders every object as a tiny rect at
 * its world position scaled to fit a fixed 160×112 pane. The current
 * viewport is drawn on top as a cyan box.
 *
 * Click anywhere in the pane → pan so that world point lands at the
 * viewport center. Drag the cyan box → continuous pan as you move.
 * Hidden when there are no objects.
 */
const MAP_W = 160;
const MAP_H = 112;
const PAD = 80; // world-coord padding around bbox so corner cards aren't clipped

export function Minimap() {
  const objects = useCanvas((s) => s.objects);
  const viewport = useCanvas((s) => s.viewport);
  const setPan = useCanvas((s) => s.setPan);

  if (objects.length === 0) return null;

  // World bbox of all objects + padding. Falls back to a centered 1000×800
  // window when objects degenerate to a single point — keeps the math sane.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objects) {
    if (o.x < minX) minX = o.x;
    if (o.y < minY) minY = o.y;
    if (o.x + o.width > maxX) maxX = o.x + o.width;
    if (o.y + o.height > maxY) maxY = o.y + o.height;
  }
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const bboxW = Math.max(100, maxX - minX);
  const bboxH = Math.max(100, maxY - minY);
  // Uniform scale so the minimap is never wider than its pane.
  const scale = Math.min(MAP_W / bboxW, MAP_H / bboxH);
  // Center the scaled bbox inside the pane.
  const offsetX = (MAP_W - bboxW * scale) / 2;
  const offsetY = (MAP_H - bboxH * scale) / 2;

  const worldToMapX = (wx: number) => offsetX + (wx - minX) * scale;
  const worldToMapY = (wy: number) => offsetY + (wy - minY) * scale;
  // page-relative coords inside the minimap → world coords. Used for click + drag.
  const mapToWorldX = (mx: number) => (mx - offsetX) / scale + minX;
  const mapToWorldY = (my: number) => (my - offsetY) / scale + minY;

  // Viewport rect in world coords: where world (0,0) sits in screen space
  // is (canvas-center + pan). Inverting that:
  //   worldX of viewport top-left = (-viewport.width/2 - pan.x) / zoom
  const vpW = viewport.width / viewport.zoom;
  const vpH = viewport.height / viewport.zoom;
  const vpLeftWorld = -viewport.width / 2 / viewport.zoom - viewport.pan.x / viewport.zoom;
  const vpTopWorld = -viewport.height / 2 / viewport.zoom - viewport.pan.y / viewport.zoom;

  const vpRect = {
    left: worldToMapX(vpLeftWorld),
    top: worldToMapY(vpTopWorld),
    width: vpW * scale,
    height: vpH * scale,
  };

  // Center a world point under the viewport: pan = -world * zoom.
  const centerOn = (wx: number, wy: number) => {
    setPan(-wx * viewport.zoom, -wy * viewport.zoom);
  };

  const onPaneDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const pane = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - pane.left;
    const localY = e.clientY - pane.top;
    centerOn(mapToWorldX(localX), mapToWorldY(localY));

    // Continuous drag — once down, follow the pointer until release.
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const lx = ev.clientX - pane.left;
      const ly = ev.clientY - pane.top;
      centerOn(mapToWorldX(lx), mapToWorldY(ly));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      className="canvas-minimap"
      role="img"
      aria-label="Canvas minimap — click or drag to pan"
      onPointerDown={onPaneDown}
    >
      {objects.map((o) => (
        <div
          key={o.id}
          className={`canvas-minimap__dot canvas-minimap__dot--${o.type}${o.checked ? " canvas-minimap__dot--checked" : ""}`}
          style={{
            left: `${worldToMapX(o.x)}px`,
            top: `${worldToMapY(o.y)}px`,
            width: `${Math.max(2, o.width * scale)}px`,
            height: `${Math.max(2, o.height * scale)}px`,
          }}
          aria-hidden="true"
        />
      ))}
      <div
        className="canvas-minimap__viewport"
        style={{
          left: `${vpRect.left}px`,
          top: `${vpRect.top}px`,
          width: `${vpRect.width}px`,
          height: `${vpRect.height}px`,
        }}
        aria-hidden="true"
      />
    </div>
  );
}
