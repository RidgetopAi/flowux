import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useCanvas } from "../../lib/store";
import { SEED_OBJECTS } from "../../lib/mockData";
import { ObjectNode } from "./ObjectNode";
import { ConnectionLayer } from "./ConnectionLayer";
import { CanvasControls } from "./CanvasControls";
import { CanvasHud } from "./CanvasHud";
import { ExpandedMRPLayer } from "./ExpandedMRP";
import { FloatingDockLayer } from "./FloatingDock";
import { Label } from "../primitives/Label";
import { BrailleBand } from "../effects/BrailleBand";
import "./Canvas.css";

export function Canvas() {
  // Only subscribe to state we actually render against. Keyboard + wheel
  // handlers pull from useCanvas.getState() inside their effects, so they
  // don't need standing subscriptions.
  const objects = useCanvas((s) => s.objects);
  const pan = useCanvas((s) => s.viewport.pan);
  const zoom = useCanvas((s) => s.viewport.zoom);
  const expandedId = useCanvas((s) => s.expandedId);
  const setExpanded = useCanvas((s) => s.setExpanded);
  const dockOpen = useCanvas((s) => s.dockOpen);
  const panBy = useCanvas((s) => s.panBy);
  const loadFixtures = useCanvas((s) => s.loadFixtures);
  const setViewportRect = useCanvas((s) => s.setViewportRect);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Measure the canvas surface's rect (position + dimensions) and keep
  // it current. Width drives the grid layout, height feeds revealMRP,
  // and position lets the locked dock convert world → fixed viewport
  // coords (toolbar pushes the canvas down, so top > 0).
  // ResizeObserver covers resize; window resize covers cases where the
  // surface's position shifts without its own size changing.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const apply = () => {
      const rect = el.getBoundingClientRect();
      setViewportRect(rect.left, rect.top, rect.width, rect.height);
    };
    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [setViewportRect]);

  // Seed fixtures on first mount. loadFixtures re-flows them into the grid
  // using the current viewport width — so the initial state is organized.
  useEffect(() => {
    if (useCanvas.getState().objects.length === 0) {
      loadFixtures(SEED_OBJECTS);
    }
  }, [loadFixtures]);

  // Window-level keyboard authority for canvas mode. Listening on window
  // (rather than the surface's React onKeyDown) means selection + nav work
  // even when focus is somewhere else — e.g. right after the compose dock
  // closes and its textarea unmounts, leaving focus on <body>. The Canvas
  // component is only mounted in canvas mode, so the listener also detaches
  // automatically when the user switches to Showcase.
  //
  // Guards (in order):
  //   1. typing in an input/textarea/contentEditable → bail (so keystrokes
  //      pass through to the editable element). Exception: "/" still opens
  //      the dock from anywhere EXCEPT inside an editable.
  //   2. dock open or expanded MRP up → bail. Those layers own their own
  //      keyboard (dock: Enter/Esc, expanded: Esc).
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inInput = !!(
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      );
      const state = useCanvas.getState();

      // "/" opens the dock from anywhere on the page (not just when the
      // canvas surface is focused). Skip when typing or when something
      // already owns the keyboard.
      if (e.key === "/") {
        if (state.dockOpen || state.expandedId || inInput) return;
        e.preventDefault();
        state.openDock();
        return;
      }

      // All other canvas shortcuts: skip when an overlay is up or when
      // the user is typing in an editable element.
      if (state.dockOpen || state.expandedId || inInput) return;

      // Cmd/Ctrl+A — check all cards (cross-platform).
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        state.checkAll();
        return;
      }

      switch (e.key) {
        case "ArrowUp":    e.preventDefault(); state.moveCursor("up",    e.shiftKey); break;
        case "ArrowDown":  e.preventDefault(); state.moveCursor("down",  e.shiftKey); break;
        case "ArrowLeft":  e.preventDefault(); state.moveCursor("left",  e.shiftKey); break;
        case "ArrowRight": e.preventDefault(); state.moveCursor("right", e.shiftKey); break;
        case "Tab":
          e.preventDefault();
          state.moveCursor(e.shiftKey ? "prev" : "next");
          break;
        case " ": {
          // Space toggles bundle inclusion on the cursor card. Seed the
          // cursor on the first card if none is set yet, so a fresh-page
          // user can hit Space immediately and see something happen.
          e.preventDefault();
          if (!state.cursorId && state.objects.length > 0) {
            state.moveCursor("first");
          }
          const cid = useCanvas.getState().cursorId;
          if (cid) state.toggleCheck(cid);
          break;
        }
        case "Escape":
          // Ladder: bundle first (cursor stays so you keep your position),
          // then cursor on the second press.
          if (state.bundleCount() > 0) {
            state.clearBundle();
          } else if (state.cursorId) {
            state.setCursor(null);
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          state.zoomBy(1.15);
          break;
        case "-":
        case "_":
          e.preventDefault();
          state.zoomBy(1 / 1.15);
          break;
        case "0":
          e.preventDefault();
          state.resetView();
          break;
      }
    };

    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, []);

  // Wheel handler — splits zoom vs pan by modifier, matching Figma/Miro:
  //   - Ctrl/Cmd + wheel    → zoom around the cursor
  //   - Trackpad pinch      → wheel + ctrlKey:true (browsers synth this) → zoom
  //   - Plain wheel/scroll  → pan (trackpad two-finger swipe, mouse wheel)
  // passive:false so we can preventDefault — otherwise Ctrl+wheel zooms the
  // whole page, and plain wheel scrolls the page behind us.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Expanded MRP overlay is rendered inside the canvas surface, so its
      // wheel events bubble up here. Let the browser handle native scroll
      // inside the overlay instead of eating it for canvas pan/zoom.
      const target = e.target as HTMLElement | null;
      if (target && target.closest(".xmrp-portal")) return;

      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        // Anchor = pointer offset from canvas center (layer origin sits at
        // canvas center + pan, so this matches store's setZoom math).
        const anchor = {
          x: e.clientX - (rect.left + rect.width / 2),
          y: e.clientY - (rect.top + rect.height / 2),
        };
        // Negative deltaY = wheel up / pinch out = zoom in.
        const factor = Math.exp(-e.deltaY * 0.0025);
        useCanvas.getState().zoomBy(factor, anchor);
      } else {
        // Natural-scroll pan: finger/wheel down → world content moves up
        // (so you see what's below). Trackpad gives both axes; mouse wheel
        // is usually deltaY only (Shift+wheel commonly inverts to deltaX).
        useCanvas.getState().panBy(-e.deltaX, -e.deltaY);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Paste + drop → image ingest. Both paths read image data, decode to a
  // data URL, and call addImage. Default placement anchors to the most-
  // recent MRP (right + gap); drop overrides x/y with the drop point in
  // world coords so the image lands where the cursor released.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const ingest = (
      file: File,
      opts?: { pos?: { x: number; y: number }; toDock?: boolean },
    ) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = typeof reader.result === "string" ? reader.result : "";
        if (!src) return;
        // Probe natural dimensions so the image fits to the tile envelope.
        const probe = new Image();
        probe.onload = () => {
          const state = useCanvas.getState();
          if (opts?.toDock) {
            // Stage in the dock — materialized into a real ImageObject
            // on send, anchored to the new MRP so prompt + image arrive
            // as one conversational turn.
            state.addDockAttachment({
              src,
              alt: file.name,
              naturalWidth: probe.naturalWidth,
              naturalHeight: probe.naturalHeight,
            });
          } else {
            // Land on the canvas as a STANDALONE object — not in any
            // conversation chain. anchoredToId:null explicitly skips the
            // default-anchor-to-last-MRP behavior. The board is for
            // reference/notes; promotion into a conversation happens
            // later by dragging or pasting into an open dock.
            const id = state.addImage({
              src,
              alt: file.name,
              naturalWidth: probe.naturalWidth,
              naturalHeight: probe.naturalHeight,
              x: opts?.pos?.x,
              y: opts?.pos?.y,
              anchoredToId: opts?.pos ? undefined : null,
            });
            state.setCursor(id);
          }
        };
        probe.src = src;
      };
      reader.readAsDataURL(file);
    };

    // Paste — image-in-clipboard wins regardless of focus target (a
    // textarea can't render an image, so swallowing the gesture in
    // chat input gives the appearance of a dead Ctrl+V). When the
    // clipboard has no image, we don't preventDefault — text paste
    // into the dock textarea / any other input still works normally.
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;

      let imageFile: File | null = null;
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFile = file;
            break; // first image wins; multi-image paste lands in a later iter
          }
        }
      }

      if (!imageFile) return; // no image → let default paste happen

      e.preventDefault();
      // Dock-open = active composition → stage in dock so prompt + image
      // arrive as one turn. Dock-closed = ambient paste → drop on canvas.
      const toDock = useCanvas.getState().dockOpen;
      ingest(imageFile, { toDock });
    };

    // Drop — convert client coords → world coords so the image lands at
    // the drop point regardless of pan/zoom. Falls back to MRP anchor
    // if the world-coord math somehow fails.
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      const [first] = files;
      if (!first) return;
      e.preventDefault();

      const { viewport } = useCanvas.getState();
      // World coords from drop client coords:
      //   world = (client - canvasTL - viewportCenter - pan) / zoom
      const worldX =
        (e.clientX - viewport.left - viewport.width / 2 - viewport.pan.x) /
        viewport.zoom;
      const worldY =
        (e.clientY - viewport.top - viewport.height / 2 - viewport.pan.y) /
        viewport.zoom;

      // Drop is a physical gesture pointing at a canvas spot — always
      // lands on canvas, regardless of whether the dock is open. Only
      // first image for v1; multi-image drops can land later.
      ingest(first, { pos: { x: worldX, y: worldY } });
    };

    // Drag-over needs preventDefault for the drop to fire at all.
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };

    window.addEventListener("paste", onPaste);
    el.addEventListener("drop", onDrop);
    el.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("paste", onPaste);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("dragover", onDragOver);
    };
  }, []);

  // Pan handler. Pointer-down on the surface (NOT on a card) starts panning.
  // We track movement on the document so panning continues even if the cursor
  // leaves the surface bounds mid-drag.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    // If the pointer is on a card (or its descendants), don't pan.
    const target = e.target as HTMLElement;
    if (target.closest("[data-canvas-card]")) return;
    // If the expanded-MRP overlay is up and the pointer is inside it,
    // don't pan (and don't dismiss via setExpanded(null) below). Backdrop
    // click handles its own dismiss; pane scrollbars need pointer events.
    if (target.closest(".xmrp-portal")) return;

    setIsPanning(true);
    setExpanded(null);

    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      panBy(dx, dy);
    };

    const onUp = () => {
      setIsPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // translate is applied BEFORE scale, so pan stays in screen pixels (1 px of
  // pointer = 1 px of canvas movement regardless of zoom). Scale is anchored
  // at the layer's transform-origin (0,0), which is the world origin pinned
  // at canvas-center via `left:50%; top:50%` in CSS.
  const layerStyle: CSSProperties = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
  };

  // Motion's drag tracks pointer in screen pixels by default. Inside a scaled
  // parent that visually amplifies/shrinks the inner motion.div, so cards
  // drift away from the cursor at any zoom != 1. transformPagePoint maps
  // screen-space pointer coords into the layer's local (world) coord system,
  // restoring 1:1 cursor-tracking. mrp.x/y stays in world pixels — no other
  // drag code changes needed.
  const transformPagePoint = ({ x, y }: { x: number; y: number }) => ({
    x: x / zoom,
    y: y / zoom,
  });

  const hasExpanded = expandedId !== null;

  return (
    <div
      ref={surfaceRef}
      className="canvas"
      role="application"
      aria-label="MRP canvas — arrows navigate, Tab cycles, Space adds to bundle, Cmd+A all, Esc clears"
      data-panning={isPanning ? "true" : undefined}
      data-has-expanded={hasExpanded ? "true" : undefined}
      data-has-dock={dockOpen ? "true" : undefined}
      onPointerDown={onPointerDown}
    >
      {/* ── Atmosphere: radial wash + scan sweep + Braille noise ──────── */}
      <div className="canvas__atmosphere" aria-hidden="true">
        <div className="canvas__wash" />
        <div className="canvas__noise" />
        <div className="canvas__sweep" />
      </div>

      {/* ── Inner layer: pan + zoom transformed, holds connections + cards ──
          MotionConfig provides transformPagePoint so Motion's drag inside the
          scaled layer maps cursor → local coords correctly at any zoom. */}
      <MotionConfig transformPagePoint={transformPagePoint}>
        <div className="canvas__layer" style={layerStyle}>
          {/* Origin crosshair — quiet reference mark at (0,0) */}
          <div className="canvas__origin" aria-hidden="true">
            <div className="canvas__origin-h" />
            <div className="canvas__origin-v" />
          </div>

          {/* Connections render behind cards */}
          <ConnectionLayer />

          {/* Cards */}
          {objects.map((obj) => (
            <ObjectNode key={obj.id} object={obj} />
          ))}
        </div>
      </MotionConfig>

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {objects.length === 0 && (
        <div className="canvas__empty">
          <Sparkles className="canvas__empty-icon" />
          <Label tone="cyan" size="label">CANVAS · IDLE</Label>
          <div className="canvas__empty-title">
            Start a conversation
          </div>
          <p className="canvas__empty-sub">
            Cards appear here as you prompt. Drag them to compose.
            Check the ones you want feeding the next response.
          </p>
          <div className="canvas__empty-band">
            <BrailleBand length={36} density={0.5} tone="cyan" seed={11} />
          </div>
        </div>
      )}

      {/* ── HUD: top-left runtime status (exec / budget / cancel) ───── */}
      <CanvasHud />

      {/* ── HUD: top-right floating controls ─────────────────────────── */}
      <CanvasControls />

      {/* ── Floating compose dock — opens via "/" or HUD button ───────── */}
      <FloatingDockLayer />

      {/* ── Expanded MRP overlay (focus = lift-off, full-screen 2-pane) ── */}
      <ExpandedMRPLayer />
    </div>
  );
}
