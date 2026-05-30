import {
  Brain,
  Check,
  CircleAlert,
  Code2,
  FileSearch,
  Loader,
  Pencil,
  PlayCircle,
  Search,
  Wrench,
  X
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useCanvas } from "../../lib/store";
import { useToolStream, type ToolStreamItem, type ToolStreamStatus } from "../../lib/toolStream";
import "./TelemetryPanel.css";

/**
 * Right-docked telemetry panel. Tool calls beam in (focus-pull), grouped by
 * the MRP that issued them, with results typing on behind a caret beam. Fed
 * live by the SSE tool buffer during a run, then by snapshot.events after.
 * Replaces the old canvas-anchored ToolCallChips.
 */
export function TelemetryPanel() {
  const open = useCanvas((s) => s.telemetryOpen);
  const toggle = useCanvas((s) => s.toggleTelemetry);
  const items = useToolStream();

  const liveCount = items.filter((t) => t.status === "started" || t.status === "streaming").length;

  // Tail-follow: keep the newest tool calls in view as they stream. The
  // content grows two ways — new rows appear AND result text types on
  // char-by-char (TypeOn) — so we can't just react to items.length. A
  // MutationObserver catches both (childList + characterData) and we scroll
  // to the bottom on any mutation, but only while the user is pinned near
  // the tail. If they scroll up to read, we stop following until they
  // return to the bottom.
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const handleScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = dist < 48;
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const followTail = () => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    };
    followTail();
    const obs = new MutationObserver(followTail);
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [open]);

  // When the panel (re)opens, snap to the tail and resume following.
  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [open]);

  return (
    <aside className="tl-panel" data-open={open ? "true" : "false"} aria-hidden={!open}>
      <div className="tl-panel__head">
        <span className="tl-panel__title">TOOL STREAM</span>
        <span className="tl-panel__count">
          {items.length} {items.length === 1 ? "call" : "calls"}
        </span>
        <span className="tl-live-dot" data-live={liveCount > 0 ? "true" : undefined} aria-hidden="true" />
        <button type="button" className="tl-panel__close" onClick={toggle} aria-label="Close telemetry panel" title="Close">
          <X size={14} />
        </button>
      </div>
      <div className="tl-band" aria-hidden="true" />
      <div className="tl-panel__body" ref={bodyRef} onScroll={handleScroll}>
        {items.length === 0 ? (
          <p className="tl-empty">
            awaiting tool activity…
            <br />
            tool calls stream here as the model works
          </p>
        ) : (
          renderGrouped(items)
        )}
      </div>
    </aside>
  );
}

/** Insert an "MRP #N" header whenever the issuing MRP changes. */
function renderGrouped(items: ToolStreamItem[]) {
  let lastSeq: number | null = null;
  return items.map((item) => {
    const header =
      item.mrpSequence !== lastSeq ? (
        <div className="tl-grp" key={`grp-${item.mrpSequence}-${item.id}`}>
          MRP #{item.mrpSequence}
        </div>
      ) : null;
    lastSeq = item.mrpSequence;
    return (
      <Fragment key={item.id}>
        {header}
        <ToolRow item={item} />
      </Fragment>
    );
  });
}

function ToolRow({ item }: { item: ToolStreamItem }) {
  const cat = colorCat(item.name);
  const Icon = iconFor(item.name);
  const streaming = item.status === "started" || item.status === "streaming";

  return (
    <div className="tl-row" data-status={item.status} data-cat={cat}>
      <span className="tl-row__icon">
        <Icon size={14} aria-hidden="true" />
      </span>
      <span className="tl-row__name" data-text={item.name}>
        {item.name}
      </span>
      <span className="tl-row__status">
        <StatusGlyph status={item.status} />
      </span>
      {item.argsSummary && <span className="tl-row__args">{item.argsSummary}</span>}
      {(item.result || streaming) && (
        <span className="tl-row__result">
          <TypeOn text={item.result ?? ""} done={!streaming} />
        </span>
      )}
    </div>
  );
}

function StatusGlyph({ status }: { status: ToolStreamStatus }) {
  switch (status) {
    case "complete":
      return <Check aria-hidden="true" />;
    case "error":
      return <CircleAlert aria-hidden="true" />;
    default:
      return <Loader className="tl-spin" aria-hidden="true" />;
  }
}

/**
 * Reveals text character-by-character behind a caret beam. Chases live-growing
 * text (deltas) and stops when caught up; the caret clears once `done` and the
 * full text is shown.
 */
function TypeOn({ text, done }: { text: string; done: boolean }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= text.length) return;
    const id = window.setTimeout(() => setShown((n) => Math.min(text.length, n + 1)), 14);
    return () => window.clearTimeout(id);
  }, [shown, text.length]);

  // If text identity shrinks (shouldn't normally), keep shown in range.
  const caught = shown >= text.length;
  return (
    <>
      {text.slice(0, shown)}
      {!(done && caught) && <span className="tl-caret" aria-hidden="true" />}
    </>
  );
}

/** Colour bucket — 4 semantic groups so hues stay distinct. */
function colorCat(name: string): "read" | "write" | "exec" | "brain" {
  const n = name.toLowerCase();
  if (n === "edit" || n === "write") return "write";
  if (n === "bash" || n === "run" || n === "shell") return "exec";
  if (n.startsWith("mandrel_") || n.startsWith("context_") || n === "smart_search") return "brain";
  return "read";
}

/** Icon mapping — finer than colour (grep keeps its magnifier, etc.). */
function iconFor(name: string): ComponentType<SVGProps<SVGSVGElement> & { size?: number }> {
  const n = name.toLowerCase();
  if (n === "read" || n === "open") return FileSearch;
  if (n === "bash" || n === "shell" || n === "run") return PlayCircle;
  if (n === "edit" || n === "write") return Pencil;
  if (n === "grep" || n === "search" || n === "find") return Search;
  if (n.startsWith("mandrel_") || n.startsWith("context_") || n === "smart_search") return Brain;
  if (n === "code" || n === "compile") return Code2;
  return Wrench;
}
