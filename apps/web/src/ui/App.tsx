import {
  Check,
  ChevronsDown,
  ChevronsUp,
  Circle,
  GitBranch,
  Loader2,
  Maximize2,
  Move,
  Plus,
  RotateCcw,
  Scan,
  Sparkles,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { Tldraw } from "tldraw";
import type { CanvasPlacement, Mrp, MrpBlock, MrpSection, MrpSectionKind } from "@flowux/shared";
import { findPlacement, useFlowuxStore } from "../store.js";

export function App() {
  const { snapshot, loading, error, loadInitial, createNewCanvas, submitPrompt, patchPlacement, snapBack } = useFlowuxStore();
  const [prompt, setPrompt] = useState("");
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [pan, setPan] = useState<{ startX: number; startY: number; x: number; y: number }>();
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const selectedCount = useMemo(
    () => snapshot?.placements.filter((placement) => placement.selectedForContext).length ?? 0,
    [snapshot?.placements]
  );

  const zoomBy = (factor: number) => {
    setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom * factor) }));
  };

  const resetView = () => {
    setViewport({ x: 0, y: 0, zoom: 1 });
  };

  const fitThread = () => {
    if (!snapshot?.placements.length) {
      resetView();
      return;
    }

    const bounds = getPlacementBounds(snapshot.placements);
    const workspace = workspaceRef.current;
    const width = workspace?.clientWidth ?? 1200;
    const height = workspace?.clientHeight ?? 760;
    const padding = 120;
    const zoom = clampZoom(Math.min((width - padding) / bounds.width, (height - padding) / bounds.height, 1));

    setViewport({
      zoom,
      x: (width - bounds.width * zoom) / 2 - bounds.left * zoom,
      y: (height - bounds.height * zoom) / 2 - bounds.top * zoom
    });
  };

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const nextZoom = clampZoom(viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08));
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const worldX = (cursorX - viewport.x) / viewport.zoom;
    const worldY = (cursorY - viewport.y) / viewport.zoom;

    setViewport({
      zoom: nextZoom,
      x: cursorX - worldX * nextZoom,
      y: cursorY - worldY * nextZoom
    });
  };

  const handlePanStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPan({ startX: event.clientX, startY: event.clientY, x: viewport.x, y: viewport.y });
  };

  const handlePanMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pan) return;
    setViewport((current) => ({
      ...current,
      x: pan.x + event.clientX - pan.startX,
      y: pan.y + event.clientY - pan.startY
    }));
  };

  const finishPan = () => setPan(undefined);
  const getVisibleLayout = () => {
    const workspace = workspaceRef.current;
    const workspaceWidth = workspace?.clientWidth ?? 1260;
    const workspaceHeight = workspace?.clientHeight ?? 760;
    return {
      layoutWidth: workspaceWidth / viewport.zoom,
      layoutLeft: -viewport.x / viewport.zoom,
      layoutTop: -viewport.y / viewport.zoom,
      rowHeight: getVisibleCardRowHeight(workspace, viewport.zoom),
      workspaceWidth,
      workspaceHeight
    };
  };
  const snapBackToVisibleWidth = () => {
    const { layoutWidth, layoutLeft, layoutTop, rowHeight } = getVisibleLayout();
    void snapBack({ layoutWidth, layoutLeft, layoutTop, rowHeight });
  };
  const sendPrompt = () => {
    const value = prompt.trim();
    if (!value) return;
    const { layoutWidth, layoutLeft, layoutTop, rowHeight, workspaceWidth, workspaceHeight } = getVisibleLayout();
    setPrompt("");
    void submitPrompt(value, { layoutWidth, layoutLeft, layoutTop, rowHeight }, ({ placement }) => {
      centerViewportOnPlacement(placement, workspaceWidth, workspaceHeight);
    });
  };

  const centerViewportOnPlacement = (placement: CanvasPlacement, workspaceWidth: number, workspaceHeight: number) => {
    setViewport((current) => ({
      ...current,
      x: workspaceWidth / 2 - (placement.x + placement.width / 2) * current.zoom,
      y: workspaceHeight / 2 - (placement.y + Math.min(placement.height, 300) / 2) * current.zoom
    }));
  };

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
        <button className="hud-button" onClick={() => void createNewCanvas()} title="Start a new blank canvas thread">
          <Plus size={15} />
          New canvas
        </button>
        <button className="hud-button" onClick={snapBackToVisibleWidth} title="Snap cards back to chronological layout">
          <RotateCcw size={15} />
          Snap back
        </button>
      </header>

      <section
        ref={workspaceRef}
        className={`workspace hud-shell ${pan ? "is-panning" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
      >
        <div className="tldraw-layer" aria-hidden="true">
          <Tldraw persistenceKey="flowux-underlay" hideUi />
        </div>

        <div className="canvas-controls hud-panel" onWheel={(event) => event.stopPropagation()}>
          <button className="icon-button" onClick={() => zoomBy(1.14)} title="Zoom in">
            <ZoomIn size={16} />
          </button>
          <button className="icon-button" onClick={() => zoomBy(0.86)} title="Zoom out">
            <ZoomOut size={16} />
          </button>
          <button className="icon-button" onClick={resetView} title="Reset view">
            <Scan size={16} />
          </button>
          <button className="icon-button" onClick={fitThread} title="Fit thread">
            <Maximize2 size={16} />
          </button>
          <span>{Math.round(viewport.zoom * 100)}%</span>
        </div>

        <div
          className="mrp-layer"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
          }}
        >
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
            return (
              <MrpCard
                key={mrp.id}
                mrp={mrp}
                placement={placement}
                sections={snapshot.sections.filter((section) => section.mrpId === mrp.id)}
                blocks={snapshot.blocks.filter((block) => block.mrpId === mrp.id)}
                zoom={viewport.zoom}
                onPatch={patchPlacement}
              />
            );
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
          onWheel={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            sendPrompt();
          }}
        >
          <button type="button" className="icon-button" title="New prompt">
            <Plus size={18} />
          </button>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                sendPrompt();
              }
            }}
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
  sections,
  blocks,
  zoom,
  onPatch
}: {
  mrp: Mrp;
  placement: CanvasPlacement;
  sections: MrpSection[];
  blocks: MrpBlock[];
  zoom: number;
  onPatch: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>;
}) {
  const [position, setPosition] = useState({ x: placement.x, y: placement.y });
  const positionRef = useRef(position);
  const [drag, setDrag] = useState<{ startX: number; startY: number; x: number; y: number }>();

  useEffect(() => {
    if (!drag) {
      const nextPosition = { x: placement.x, y: placement.y };
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    }
  }, [drag, placement.x, placement.y]);

  const finishDrag = () => {
    if (!drag) return;
    setDrag(undefined);
    const finalPosition = positionRef.current;
    if (finalPosition.x !== placement.x || finalPosition.y !== placement.y) {
      void onPatch(mrp.id, finalPosition);
    }
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isCardControl(event.target)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startX: event.clientX, startY: event.clientY, x: positionRef.current.x, y: positionRef.current.y });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const nextPosition = {
      x: drag.x + (event.clientX - drag.startX) / zoom,
      y: drag.y + (event.clientY - drag.startY) / zoom
    };
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  };

  const promptText = getSectionText(sections, blocks, "prompt") || mrp.userPrompt;
  const responseText = getSectionText(sections, blocks, "response") || mrp.assistantResponse || "Waiting for model output...";
  const detailSections = sections
    .filter((section) => !["prompt", "response"].includes(section.kind))
    .sort((a, b) => a.sequence - b.sequence);

  return (
    <article
      className={`mrp-card hud-panel ${drag ? "is-dragging" : ""} ${placement.selectedForContext ? "is-selected" : ""} ${
        placement.isExternalReference ? "is-external" : ""
      }`}
      style={{
        left: position.x,
        top: position.y,
        width: placement.width,
        minHeight: placement.collapsed ? 124 : placement.height
      }}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="mrp-drag">
        <Move size={14} />
        <span>MRP {mrp.sequence.toString().padStart(2, "0")}</span>
        <span className={`status status-${mrp.status}`}>{mrp.status}</span>
      </div>

      <div className="mrp-head">
        <button
          data-no-card-drag
          className="check-circle"
          onClick={() => void onPatch(mrp.id, { selectedForContext: !placement.selectedForContext })}
          title="Toggle active context"
        >
          {placement.selectedForContext ? <Check size={16} /> : <Circle size={16} />}
        </button>
        <h2>{mrp.title || "Untitled MRP"}</h2>
        <button
          data-no-card-drag
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
            <p>{promptText}</p>
          </section>
          <section>
            <p className="hud-label">Response</p>
            <p>{responseText}</p>
          </section>
          {detailSections.length > 0 && (
            <section className="mrp-internals">
              <p className="hud-label">Internals</p>
              <div className="mrp-section-list">
                {detailSections.map((section) => (
                  <MrpSectionDrawer
                    key={section.id}
                    section={section}
                    blocks={blocks.filter((block) => block.sectionId === section.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <footer>
        <GitBranch size={13} />
        <span>{placement.isExternalReference ? "external reference" : "thread native"}</span>
      </footer>
    </article>
  );
}

function MrpSectionDrawer({ section, blocks }: { section: MrpSection; blocks: MrpBlock[] }) {
  const body = formatSectionBody(section, blocks);
  return (
    <details className={`mrp-section-drawer section-${section.kind}`} data-no-card-drag open={!section.collapsedByDefault}>
      <summary>
        <span className="section-title">
          {section.kind === "thinking" && <Sparkles size={13} />}
          {section.title}
        </span>
        <span>{section.summary || summarizeSection(section, blocks)}</span>
      </summary>
      <pre>{body}</pre>
    </details>
  );
}

function getSectionText(sections: MrpSection[], blocks: MrpBlock[], kind: MrpSectionKind) {
  const section = sections.find((item) => item.kind === kind);
  if (!section) return "";
  return blocks
    .filter((block) => block.sectionId === section.id)
    .map((block) => (typeof block.content.text === "string" ? block.content.text : ""))
    .join("\n")
    .trim();
}

function formatSectionBody(section: MrpSection, blocks: MrpBlock[]) {
  if (!blocks.length) return section.summary || "No captured content.";
  return blocks
    .map((block) => {
      if (typeof block.content.text === "string") return block.content.text;
      return JSON.stringify(block.content, null, 2);
    })
    .join("\n\n");
}

function summarizeSection(section: MrpSection, blocks: MrpBlock[]) {
  const firstBlock = blocks[0];
  if (!firstBlock) return "empty";
  if (typeof firstBlock.content.text === "string") {
    return `${firstBlock.content.text.length} chars`;
  }
  if (section.kind === "usage" && typeof firstBlock.content.usage === "object") return "tokens";
  return `${blocks.length} block${blocks.length === 1 ? "" : "s"}`;
}

function isCardControl(target: EventTarget) {
  return target instanceof Element
    ? Boolean(target.closest("button, a, input, textarea, select, [data-no-card-drag]"))
    : false;
}

function clampZoom(value: number) {
  return Math.min(1.8, Math.max(0.35, value));
}

function getPlacementBounds(placements: CanvasPlacement[]) {
  const left = Math.min(...placements.map((placement) => placement.x));
  const top = Math.min(...placements.map((placement) => placement.y));
  const right = Math.max(...placements.map((placement) => placement.x + placement.width));
  const bottom = Math.max(...placements.map((placement) => placement.y + placement.height));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function getVisibleCardRowHeight(workspace: HTMLElement | null, zoom: number) {
  if (!workspace) return 600;
  const heights = Array.from(workspace.querySelectorAll<HTMLElement>(".mrp-card")).map((card) => {
    return card.getBoundingClientRect().height / zoom;
  });
  const maxHeight = heights.length ? Math.max(...heights) : 520;
  return Math.ceil(maxHeight + 22);
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
