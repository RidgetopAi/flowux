import type { CanvasPlacement, CanvasSnapshot } from "@flowux/shared";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Canvas } from "../components/canvas/Canvas";
import { CanvasControls } from "../components/canvas/CanvasControls";
import { Sidebar } from "../components/sidebar/Sidebar";
import { PiTargetSelector } from "../components/sidebar/PiTargetSelector";
import { ChromaText } from "../components/effects/ChromaText";
import { Button } from "../components/primitives/Button";
import { Label } from "../components/primitives/Label";
import { Pill } from "../components/primitives/Pill";
import { InvadersOverlay } from "../game/Invaders";
import { arrangeGrid } from "../lib/layout";
import {
  fitImageEnvelope,
  useCanvas,
  type ForkHandler,
  type ImageDeleteHandler,
  type ImageDropHandler,
  type MovePersistHandler,
  type SubmitPromptHandler,
} from "../lib/store";
import { CANVAS_IMAGE_ID_PREFIX } from "../lib/canvasAdapter";
import { useFlowuxStore } from "../store.js";
import * as api from "../api";

export function App() {
  const snapshot = useFlowuxStore((s) => s.snapshot);
  const canvases = useFlowuxStore((s) => s.canvases);
  const loading = useFlowuxStore((s) => s.loading);
  const error = useFlowuxStore((s) => s.error);
  const loadInitial = useFlowuxStore((s) => s.loadInitial);
  const switchCanvas = useFlowuxStore((s) => s.switchCanvas);
  const createNewCanvas = useFlowuxStore((s) => s.createNewCanvas);
  const renameCurrentCanvas = useFlowuxStore((s) => s.renameCurrentCanvas);
  const saveCurrentCanvas = useFlowuxStore((s) => s.saveCurrentCanvas);
  const deleteCurrentCanvas = useFlowuxStore((s) => s.deleteCurrentCanvas);
  const submitPrompt = useFlowuxStore((s) => s.submitPrompt);
  const patchPlacement = useFlowuxStore((s) => s.patchPlacement);

  const loadFromSnapshot = useCanvas((s) => s.loadFromSnapshot);
  const setSubmitPromptHandler = useCanvas((s) => s.setSubmitPromptHandler);
  const setMovePersistHandler = useCanvas((s) => s.setMovePersistHandler);
  const setImageDropHandler = useCanvas((s) => s.setImageDropHandler);
  const setImageDeleteHandler = useCanvas((s) => s.setImageDeleteHandler);
  const setForkHandler = useCanvas((s) => s.setForkHandler);
  const addCanvasImage = useFlowuxStore((s) => s.addCanvasImage);
  const patchCanvasImage = useFlowuxStore((s) => s.patchCanvasImage);
  const removeCanvasImage = useFlowuxStore((s) => s.removeCanvasImage);
  const createChildCanvasFromSelection = useFlowuxStore(
    (s) => s.createChildCanvasFromSelection,
  );

  // After a dock send, apps/api confirms the new placement via the
  // submitPrompt onCreated callback. We stash that real placement id
  // here so the next loadFromSnapshot run can expand + reveal the new
  // MRP — FloatingDock's own setExpanded/revealMRP fires synchronously
  // with the placeholder id we hand back from the handler, which doesn't
  // exist in useCanvas yet, so it silently no-ops without this bridge.
  const pendingFocusId = useRef<string | null>(null);
  // Canvas we've already framed the camera for. On a fresh load / canvas
  // switch we center on the newest MRP; we DON'T re-frame on same-canvas
  // reloads (e.g. after a prompt completes) so the camera isn't yanked
  // while the user is working.
  const framedCanvasId = useRef<string | null>(null);
  // One-shot per-canvas migration of legacy workspace-era 360×240 placements
  // to the lean canvas's 320×240 tight grid. Tracks which canvas ids have
  // already been migrated this session so a refetched snapshot doesn't
  // re-trigger after the optimistic patch is in-flight.
  const migratedCanvasIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!snapshot) return;
    loadFromSnapshot(snapshot);

    maybeMigrateLegacyLayout(snapshot, migratedCanvasIds.current, patchPlacement);

    // First load / canvas switch: center the camera on the newest MRP so
    // resuming a board lands on the most recent card instead of empty
    // space above it. rAF lets Canvas's ResizeObserver set the real
    // viewport size before revealMRP does its centering math.
    if (snapshot.canvas.id !== framedCanvasId.current) {
      framedCanvasId.current = snapshot.canvas.id;
      if (!pendingFocusId.current) {
        requestAnimationFrame(() => {
          const objs = useCanvas.getState().objects;
          let lastId: string | null = null;
          let lastSeq = -Infinity;
          for (const o of objs) {
            if (o.type === "mrp" && o.sequence > lastSeq) {
              lastSeq = o.sequence;
              lastId = o.id;
            }
          }
          if (lastId) useCanvas.getState().revealMRP(lastId);
        });
      }
    }

    const target = pendingFocusId.current;
    if (!target) return;
    // Confirm the target landed in the new objects array before consuming.
    const exists = useCanvas.getState().objects.some((o) => o.id === target);
    if (!exists) return;
    pendingFocusId.current = null;
    // rAF gives Canvas's ResizeObserver one tick to update viewport
    // dimensions before revealMRP does its centering math.
    requestAnimationFrame(() => {
      useCanvas.setState({ expandedId: target, cursorId: target });
      useCanvas.getState().revealMRP(target);
    });
  }, [snapshot, loadFromSnapshot, patchPlacement]);

  useEffect(() => {
    const handler: SubmitPromptHandler = ({ prompt, attachments }) => {
      // Resolve every staged attachment to a server upload id, then send.
      // Lazy: a chip carrying `uploadId` (parked-image promotion, P4) reuses
      // it; one carrying a raw `file` uploads now. Uploads run in the
      // background — the handler still returns a synchronous placeholder id
      // because the real focus target arrives via the onCreated callback.
      void (async () => {
        const resolved = await Promise.all(
          attachments.map(async (att) => {
            if (att.uploadId) return { id: att.uploadId };
            if (att.file) {
              const uploaded = await api.uploadAttachment(att.file);
              return { id: uploaded.id };
            }
            return null;
          }),
        );
        const ids = resolved.filter((a): a is { id: string } => a !== null);
        await submitPrompt(prompt, undefined, ids, ({ placement }) => {
          // Always promote the freshly-sent message to the expanded view —
          // even if another MRP was open, it collapses back to its tile.
          pendingFocusId.current = placement.id;
        });
      })();
      return `pending-${Date.now().toString(36)}`;
    };
    setSubmitPromptHandler(handler);
    return () => setSubmitPromptHandler(null);
  }, [submitPrompt, setSubmitPromptHandler]);

  // Persist drag-end + arrange-all to apps/api. CanvasObject.id IS the
  // placement.id for MRPs (per canvasAdapter), but patchPlacement keys on
  // mrpId so look it up from the current snapshot. Parked images carry the
  // `canvasimage-<id>` prefix and route to the images endpoint instead.
  useEffect(() => {
    const handler: MovePersistHandler = (objectId, x, y) => {
      if (objectId.startsWith(CANVAS_IMAGE_ID_PREFIX)) {
        const imageId = objectId.slice(CANVAS_IMAGE_ID_PREFIX.length);
        void patchCanvasImage(imageId, { x, y });
        return;
      }
      const placement = useFlowuxStore
        .getState()
        .snapshot?.placements.find((p) => p.id === objectId);
      if (!placement) return;
      void patchPlacement(placement.mrpId, { x, y });
    };
    setMovePersistHandler(handler);
    return () => setMovePersistHandler(null);
  }, [patchPlacement, patchCanvasImage, setMovePersistHandler]);

  // Parked-image drop/paste → upload + persist as a free-floating canvas
  // image (server-authoritative; reappears via the next snapshot). pos is the
  // world-coord drop point, or undefined for ambient paste — default to the
  // current viewport center so it lands somewhere visible.
  useEffect(() => {
    const handler: ImageDropHandler = (file, pos, naturalWidth, naturalHeight) => {
      const { width, height } = fitImageEnvelope(naturalWidth, naturalHeight);
      let x: number;
      let y: number;
      if (pos) {
        x = pos.x;
        y = pos.y;
      } else {
        const { pan, zoom } = useCanvas.getState().viewport;
        x = -pan.x / zoom - width / 2;
        y = -pan.y / zoom - height / 2;
      }
      void addCanvasImage({ file, x, y, width, height, naturalWidth, naturalHeight });
    };
    setImageDropHandler(handler);
    return () => setImageDropHandler(null);
  }, [addCanvasImage, setImageDropHandler]);

  // Parked-image delete → remove from server + snapshot (canvas-layer removal
  // is optimistic inside ImageCard via removeObject).
  useEffect(() => {
    const handler: ImageDeleteHandler = (serverImageId) => {
      void removeCanvasImage(serverImageId);
    };
    setImageDeleteHandler(handler);
    return () => setImageDeleteHandler(null);
  }, [removeCanvasImage, setImageDeleteHandler]);

  // Bundle-fork from an MRP card's fork button. MRPCard ships CanvasObject
  // ids (= placement.ids per canvasAdapter); resolve them to the underlying
  // mrpIds via the current snapshot before posting the branch request.
  useEffect(() => {
    const handler: ForkHandler = (objectIds) => {
      const placements = useFlowuxStore.getState().snapshot?.placements ?? [];
      const mrpIds = objectIds
        .map((oid) => placements.find((p) => p.id === oid)?.mrpId)
        .filter((id): id is string => Boolean(id));
      if (mrpIds.length === 0) return;
      void createChildCanvasFromSelection(mrpIds);
    };
    setForkHandler(handler);
    return () => setForkHandler(null);
  }, [createChildCanvasFromSelection, setForkHandler]);

  const createNamedCanvas = () => {
    const name = window.prompt("Name this canvas", "New Canvas");
    if (name === null) return;
    void createNewCanvas(name.trim() || "Flowux Canvas");
  };

  const renameCanvas = () => {
    if (!snapshot) return;
    const name = window.prompt("Rename this canvas", snapshot.canvas.title);
    if (name === null) return;
    void renameCurrentCanvas(name);
  };

  const deleteCanvas = () => {
    if (!snapshot) return;
    const ok = window.confirm(`Delete canvas "${snapshot.canvas.title}"?`);
    if (!ok) return;
    void deleteCurrentCanvas();
  };

  const canvasStatus = snapshot?.canvas.status ?? (loading ? "loading" : "—");

  return (
    <main className="flowux-app">
      <header className="flowux-topbar">
        <div className="flowux-brand">
          <ChromaText as="span" className="flowux-brand__mark">
            FLOWUX
          </ChromaText>
          <Label size="micro" tone="muted">
            SPATIAL · 0.1
          </Label>
        </div>

        <div className="flowux-canvas-ctl">
          <Label size="micro" tone="muted">
            Canvas
          </Label>
          <select
            className="flowux-canvas-select"
            value={snapshot?.canvas.id ?? ""}
            onChange={(event) => void switchCanvas(event.target.value)}
            disabled={!canvases.length}
            title="Switch canvas thread"
          >
            {canvases.length === 0 && <option value="">No canvases</option>}
            {canvases.map((canvas) => (
              <option key={canvas.id} value={canvas.id}>
                {canvas.title}
              </option>
            ))}
          </select>
          <Button
            iconOnly
            size="sm"
            icon={<Plus size={15} />}
            onClick={createNamedCanvas}
            title="New canvas"
          />
          <Button
            iconOnly
            size="sm"
            icon={<Pencil size={15} />}
            onClick={renameCanvas}
            disabled={!snapshot}
            title="Rename canvas"
          />
          <Button
            iconOnly
            size="sm"
            icon={<Save size={15} />}
            onClick={() => void saveCurrentCanvas()}
            disabled={!snapshot || snapshot.canvas.status === "saved"}
            title="Save canvas"
          />
          <Button
            iconOnly
            size="sm"
            variant="danger"
            icon={<Trash2 size={15} />}
            onClick={deleteCanvas}
            disabled={!snapshot}
            title="Delete canvas"
          />
        </div>

        <div className="flowux-status">
          <CanvasControls variant="bar" />
          <span className="flowux-topbar-sep" aria-hidden="true" />
          <PiTargetSelector />
          <Pill tone="neutral">{canvasStatus}</Pill>
        </div>
      </header>

      {error && <div className="flowux-error">{error}</div>}

      <div className="flowux-stage">
        <Sidebar />
        <div className="flowux-canvas-host">
          {loading && !snapshot && (
            <div className="flowux-loading">
              <Loader2 className="spin" size={18} />
              <span>Loading Flowux…</span>
            </div>
          )}
          <Canvas />
        </div>
      </div>

      <InvadersOverlay />
    </main>
  );
}

// Lean canvas uses 320×240 tiles in a tight 8px-gap grid. Older canvases were
// persisted with the workspace-era 360×240 layout, so cards land overlapping
// when adapted into the new grid. Detect those once per canvas, re-arrange,
// and persist x/y/width/height in a single PATCH per placement so the
// migration is idempotent on subsequent loads.
const LEAN_TILE_W = 320;
const LEAN_TILE_H = 240;

function maybeMigrateLegacyLayout(
  snapshot: CanvasSnapshot,
  alreadyMigrated: Set<string>,
  patchPlacement: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>,
): void {
  const canvasId = snapshot.canvas.id;
  if (alreadyMigrated.has(canvasId)) return;

  const isLegacy = (p: CanvasPlacement) => p.width !== LEAN_TILE_W || p.height !== LEAN_TILE_H;
  if (!snapshot.placements.some(isLegacy)) return;

  alreadyMigrated.add(canvasId);

  // rAF so Canvas's ResizeObserver has set viewport.width before arrangeGrid
  // computes the column count.
  requestAnimationFrame(() => {
    const viewportWidth = useCanvas.getState().viewport.width;
    const positions = arrangeGrid({
      count: snapshot.placements.length,
      viewportWidth,
    });

    // canvasAdapter iterates snapshot.placements in order, then appends image
    // artifacts. MRP objects 0..N-1 in useCanvas.objects line up with
    // snapshot.placements 0..N-1, so positions[i] maps to objects[i].
    useCanvas.setState((s) => ({
      objects: s.objects.map((o, i) => {
        const pos = positions[i];
        if (!pos) return o;
        return { ...o, x: pos.x, y: pos.y };
      }),
    }));

    snapshot.placements.forEach((placement, i) => {
      if (!isLegacy(placement)) return;
      const pos = positions[i];
      if (!pos) return;
      void patchPlacement(placement.mrpId, {
        x: pos.x,
        y: pos.y,
        width: LEAN_TILE_W,
        height: LEAN_TILE_H,
      });
    });
  });
}
