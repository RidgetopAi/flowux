import { Maximize2, MessageSquarePlus, Trash2, LayoutGrid, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCanvas, ZOOM_MIN, ZOOM_MAX } from "../../lib/store";
import { Button } from "../primitives/Button";
import { Pill } from "../primitives/Pill";
import { Label } from "../primitives/Label";
import "./CanvasControls.css";

export function CanvasControls() {
  const objects = useCanvas((s) => s.objects);
  const bundleCount = useCanvas((s) => s.bundleCount());
  const zoom = useCanvas((s) => s.viewport.zoom);
  const openDock = useCanvas((s) => s.openDock);
  const zoomBy = useCanvas((s) => s.zoomBy);
  const resetView = useCanvas((s) => s.resetView);
  const zoomToFit = useCanvas((s) => s.zoomToFit);
  const arrangeAll = useCanvas((s) => s.arrangeAll);
  const loadFixtures = useCanvas((s) => s.loadFixtures);
  const clearBundle = useCanvas((s) => s.clearBundle);

  const handleArrange = () => {
    arrangeAll();
    // Recenter so the freshly-flowed grid sits in the viewport
    useCanvas.getState().resetView();
  };

  const zoomPct = Math.round(zoom * 100);
  const atMin = zoom <= ZOOM_MIN + 1e-3;
  const atMax = zoom >= ZOOM_MAX - 1e-3;

  const handleClear = () => {
    if (confirm("Clear all MRPs on the canvas?")) {
      loadFixtures([]);
    }
  };

  return (
    <div className="canvas-controls">
      <div className="canvas-controls__bundle">
        <Label size="micro" tone="muted">BUNDLE</Label>
        <Pill tone={bundleCount > 0 ? "cyan" : "neutral"} emphasis={bundleCount > 0}>
          {bundleCount} / {objects.length}
        </Pill>
        {bundleCount > 0 && (
          <button
            type="button"
            className="canvas-controls__clear"
            onClick={clearBundle}
            aria-label="Clear bundle"
            title="Clear bundle (Esc)"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="canvas-controls__divider" />

      <div className="canvas-controls__zoom">
        <Button
          variant="ghost"
          size="md"
          iconOnly
          onClick={() => zoomBy(1 / 1.15)}
          disabled={atMin}
          aria-label="Zoom out"
          title="Zoom out (-)"
        >
          <ZoomOut />
        </Button>
        <button
          type="button"
          className="canvas-controls__zoom-pct"
          onClick={resetView}
          aria-label={`Reset view (current zoom ${zoomPct}%)`}
          title="Reset view (0)"
        >
          {zoomPct}%
        </button>
        <Button
          variant="ghost"
          size="md"
          iconOnly
          onClick={() => zoomBy(1.15)}
          disabled={atMax}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <ZoomIn />
        </Button>
      </div>

      <div className="canvas-controls__divider" />

      <div className="canvas-controls__actions">
        <Button
          variant="ghost"
          size="md"
          iconOnly
          onClick={zoomToFit}
          aria-label="Zoom to fit all cards"
          title="Zoom to fit (F)"
        >
          <Maximize2 />
        </Button>
        <Button
          variant="ghost"
          size="md"
          iconOnly
          onClick={handleArrange}
          aria-label="Auto-arrange into grid"
          title="Auto-arrange into grid"
        >
          <LayoutGrid />
        </Button>
        <Button
          variant="primary"
          size="md"
          iconOnly
          onClick={openDock}
          aria-label="Compose new message (/)"
          title="Compose new message (/)"
        >
          <MessageSquarePlus />
        </Button>
        <Button
          variant="ghost"
          size="md"
          iconOnly
          onClick={handleClear}
          aria-label="Clear canvas"
          title="Clear canvas"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
