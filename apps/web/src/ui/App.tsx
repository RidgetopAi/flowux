import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Canvas } from "../components/canvas/Canvas";
import { ChromaText } from "../components/effects/ChromaText";
import { Button } from "../components/primitives/Button";
import { Label } from "../components/primitives/Label";
import { Pill } from "../components/primitives/Pill";
import { useCanvas, type MovePersistHandler, type SubmitPromptHandler } from "../lib/store";
import { useFlowuxStore } from "../store.js";

export function App() {
  const snapshot = useFlowuxStore((s) => s.snapshot);
  const canvases = useFlowuxStore((s) => s.canvases);
  const loading = useFlowuxStore((s) => s.loading);
  const error = useFlowuxStore((s) => s.error);
  const executionContext = useFlowuxStore((s) => s.executionContext);
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

  // After a dock send, apps/api confirms the new placement via the
  // submitPrompt onCreated callback. We stash that real placement id
  // here so the next loadFromSnapshot run can expand + reveal the new
  // MRP — FloatingDock's own setExpanded/revealMRP fires synchronously
  // with the placeholder id we hand back from the handler, which doesn't
  // exist in useCanvas yet, so it silently no-ops without this bridge.
  const pendingFocusId = useRef<string | null>(null);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!snapshot) return;
    loadFromSnapshot(snapshot);

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
  }, [snapshot, loadFromSnapshot]);

  useEffect(() => {
    const handler: SubmitPromptHandler = ({ prompt }) => {
      void submitPrompt(prompt, undefined, undefined, ({ placement }) => {
        pendingFocusId.current = placement.id;
      });
      return `pending-${Date.now().toString(36)}`;
    };
    setSubmitPromptHandler(handler);
    return () => setSubmitPromptHandler(null);
  }, [submitPrompt, setSubmitPromptHandler]);

  // Persist drag-end + arrange-all to apps/api. CanvasObject.id IS the
  // placement.id (per canvasAdapter), but patchPlacement keys on mrpId
  // so look it up from the current snapshot.
  useEffect(() => {
    const handler: MovePersistHandler = (objectId, x, y) => {
      const placement = useFlowuxStore
        .getState()
        .snapshot?.placements.find((p) => p.id === objectId);
      if (!placement) return;
      void patchPlacement(placement.mrpId, { x, y });
    };
    setMovePersistHandler(handler);
    return () => setMovePersistHandler(null);
  }, [patchPlacement, setMovePersistHandler]);

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
  const execLabel = executionContext
    ? `${executionContext.harness} · ${
        executionContext.hostLabel ?? "—"
      }`
    : "boot";

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
          <Pill tone="cyan">{execLabel}</Pill>
          <Pill tone="neutral">{canvasStatus}</Pill>
        </div>
      </header>

      {error && <div className="flowux-error">{error}</div>}

      <div className="flowux-stage">
        {loading && !snapshot && (
          <div className="flowux-loading">
            <Loader2 className="spin" size={18} />
            <span>Loading Flowux…</span>
          </div>
        )}
        <Canvas />
      </div>
    </main>
  );
}
