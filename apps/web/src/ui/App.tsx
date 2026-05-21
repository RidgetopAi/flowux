import { Check, ChevronsDown, ChevronsUp, Circle, GitBranch, Loader2, Move, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Tldraw } from "tldraw";
import type { CanvasPlacement, Mrp } from "@flowux/shared";
import { findPlacement, useFlowuxStore } from "../store.js";

export function App() {
  const { snapshot, loading, error, loadInitial, submitPrompt, patchPlacement, snapBack } = useFlowuxStore();
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const selectedCount = useMemo(
    () => snapshot?.placements.filter((placement) => placement.selectedForContext).length ?? 0,
    [snapshot?.placements]
  );

  return (
    <main className="flowux-app">
      <header className="topbar hud-panel">
        <div>
          <p className="hud-label">Spatial Thread</p>
          <h1>Flowux</h1>
        </div>
        <div className="telemetry">
          <span>{snapshot?.mrps.length ?? 0} MRPs</span>
          <span>{selectedCount} checked</span>
          <span>{snapshot?.canvas.status ?? "loading"}</span>
        </div>
        <button className="hud-button" onClick={() => void snapBack()} title="Snap cards back to chronological layout">
          <RotateCcw size={15} />
          Snap back
        </button>
      </header>

      <section className="workspace hud-shell">
        <div className="tldraw-layer" aria-hidden="true">
          <Tldraw persistenceKey="flowux-underlay" hideUi />
        </div>

        <div className="mrp-layer">
          {loading && (
            <div className="empty-state hud-panel">
              <Loader2 className="spin" size={18} />
              Loading Flowux
            </div>
          )}

          {error && <div className="error-banner hud-panel">{error}</div>}

          {snapshot?.mrps.map((mrp) => {
            const placement = findPlacement(snapshot, mrp);
            if (!placement) return null;
            return <MrpCard key={mrp.id} mrp={mrp} placement={placement} onPatch={patchPlacement} />;
          })}

          {snapshot &&
            snapshot.mrps.slice(1).map((mrp, index) => {
              const previous = snapshot.mrps[index];
              if (!previous) return null;
              const a = findPlacement(snapshot, previous);
              const b = findPlacement(snapshot, mrp);
              if (!a || !b || a.connectionHidden || b.connectionHidden) return null;
              return <Connection key={`${previous.id}-${mrp.id}`} from={a} to={b} />;
            })}
        </div>

        <form
          className="prompt-dock hud-panel"
          onSubmit={(event) => {
            event.preventDefault();
            const value = prompt.trim();
            if (!value) return;
            setPrompt("");
            void submitPrompt(value);
          }}
        >
          <button type="button" className="icon-button" title="New prompt">
            <Plus size={18} />
          </button>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Prompt this canvas thread..."
            rows={2}
          />
          <button type="submit" className="hud-button hud-button-primary">
            Send
          </button>
        </form>
      </section>
    </main>
  );
}

function MrpCard({
  mrp,
  placement,
  onPatch
}: {
  mrp: Mrp;
  placement: CanvasPlacement;
  onPatch: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>;
}) {
  const [drag, setDrag] = useState<{ startX: number; startY: number; x: number; y: number }>();

  return (
    <article
      className={`mrp-card hud-panel ${placement.selectedForContext ? "is-selected" : ""} ${
        placement.isExternalReference ? "is-external" : ""
      }`}
      style={{
        left: placement.x,
        top: placement.y,
        width: placement.width,
        minHeight: placement.collapsed ? 124 : placement.height
      }}
    >
      <div
        className="mrp-drag"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ startX: event.clientX, startY: event.clientY, x: placement.x, y: placement.y });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          void onPatch(mrp.id, {
            x: drag.x + event.clientX - drag.startX,
            y: drag.y + event.clientY - drag.startY
          });
        }}
        onPointerUp={() => setDrag(undefined)}
      >
        <Move size={14} />
        <span>MRP {mrp.sequence.toString().padStart(2, "0")}</span>
        <span className={`status status-${mrp.status}`}>{mrp.status}</span>
      </div>

      <div className="mrp-head">
        <button
          className="check-circle"
          onClick={() => void onPatch(mrp.id, { selectedForContext: !placement.selectedForContext })}
          title="Toggle active context"
        >
          {placement.selectedForContext ? <Check size={16} /> : <Circle size={16} />}
        </button>
        <h2>{mrp.title || "Untitled MRP"}</h2>
        <button
          className="icon-button"
          onClick={() => void onPatch(mrp.id, { collapsed: !placement.collapsed })}
          title={placement.collapsed ? "Expand card" : "Collapse card"}
        >
          {placement.collapsed ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
        </button>
      </div>

      {!placement.collapsed && (
        <div className="mrp-body">
          <section>
            <p className="hud-label">Prompt</p>
            <p>{mrp.userPrompt}</p>
          </section>
          <section>
            <p className="hud-label">Response</p>
            <p>{mrp.assistantResponse || "Waiting for model output..."}</p>
          </section>
        </div>
      )}

      <footer>
        <GitBranch size={13} />
        <span>{placement.isExternalReference ? "external reference" : "thread native"}</span>
      </footer>
    </article>
  );
}

function Connection({ from, to }: { from: CanvasPlacement; to: CanvasPlacement }) {
  const x1 = from.x + from.width;
  const y1 = from.y + 80;
  const x2 = to.x;
  const y2 = to.y + 80;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1) || 1;
  const height = Math.abs(y2 - y1) || 1;

  return (
    <svg className="connection" style={{ left, top, width, height }} viewBox={`0 0 ${width} ${height}`}>
      <line
        x1={x1 < x2 ? 0 : width}
        y1={y1 < y2 ? 0 : height}
        x2={x1 < x2 ? width : 0}
        y2={y1 < y2 ? height : 0}
      />
    </svg>
  );
}

