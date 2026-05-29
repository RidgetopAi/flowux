import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Wrench, FileText, Zap, ChevronRight, ArrowLeftToLine } from "lucide-react";
import { useCanvas, type MRP } from "../../lib/store";
import { useFlowuxStore } from "../../store.js";
import { Pill } from "../primitives/Pill";
import { Label } from "../primitives/Label";
import { Button } from "../primitives/Button";
import { Markdown } from "../primitives/Markdown";
import { StatusDot } from "../primitives/StatusDot";
import { BrailleBand } from "../effects/BrailleBand";
import { cn } from "../../lib/cn";
import type { MrpEvent } from "@flowux/shared";
import "./ExpandedMRP.css";

/**
 * Full-screen overlay for a focused MRP. Uses Motion's `layoutId` to
 * share-transition from the small card slot to this expanded view —
 * the card visibly "lifts off" the canvas into a 2-pane reading layout.
 *
 * Left pane: prompt + response (the conversation).
 * Right pane: call telemetry (tools, files, stats — mocked for Phase 2.1).
 *
 * Dismiss: click backdrop, press Escape, or click the X.
 */
export function ExpandedMRPLayer() {
  const expandedId = useCanvas((s) => s.expandedId);
  /* The expanded view is currently MRP-only (other object variants don't
   * have a prompt/response/telemetry pane). Narrow the lookup to MRPs;
   * non-MRP expandedIds just leave the overlay closed. */
  const mrp = useCanvas((s) => {
    if (!s.expandedId) return undefined;
    const obj = s.objects.find((o) => o.id === s.expandedId);
    return obj && obj.type === "mrp" ? obj : undefined;
  });
  const setExpanded = useCanvas((s) => s.setExpanded);

  // Escape dismisses
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId, setExpanded]);

  return (
    <AnimatePresence>
      {expandedId && mrp && (
        <ExpandedMRP key={expandedId} mrp={mrp} onDismiss={() => setExpanded(null)} />
      )}
    </AnimatePresence>
  );
}

type SidecarSection = "tools" | "files";

function ExpandedMRP({ mrp, onDismiss }: { mrp: MRP; onDismiss: () => void }) {
  const highlight = useCanvas((s) => s.expandedHighlight);
  // Pull this MRP's real events + run from the apps/api snapshot. The
  // CanvasObject.id IS the placement.id, so we look up the placement to
  // find the underlying server mrpId, then filter events/runs by it.
  const events = useFlowuxStore((s) => s.snapshot?.events ?? []);
  const modelRuns = useFlowuxStore((s) => s.snapshot?.modelRuns ?? []);
  const placement = useFlowuxStore((s) =>
    s.snapshot?.placements.find((p) => p.id === mrp.id),
  );
  const telemetry = useMemo(
    () => realTelemetry(mrp, placement?.mrpId, events, modelRuns),
    [mrp, placement?.mrpId, events, modelRuns],
  );

  // Sidecar pops Tool Calls / Files Touched into a wider middle pane so
  // the right column doesn't squeeze them to a single line when the dock
  // is open. State is local — closing the overlay drops it automatically.
  const [sidecarSection, setSidecarSection] = useState<SidecarSection | null>(null);
  const togglePopOut = (section: SidecarSection) =>
    setSidecarSection((cur) => (cur === section ? null : section));
  // Esc layers — if the sidecar is open, swallow Esc to close it first;
  // the parent's window-listener will only get the next Esc, which then
  // dismisses the overlay. We do this with a captured-phase listener so
  // we fire before the parent.
  useEffect(() => {
    if (!sidecarSection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setSidecarSection(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sidecarSection]);

  return (
    <div className="xmrp-portal">
      {/* Backdrop — dims + blurs the canvas stack */}
      <motion.div
        className="xmrp-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onClick={onDismiss}
      />

      {/* Independent entrance — no layoutId. The expanded view always animates
          the same way regardless of where on canvas the source card lived
          (so an off-screen card and a centered card open with identical feel).
          Small scale-up + slight rise + fade = "settles into place." */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className={cn("xmrp", mrp.external && "xmrp--external")}
        style={{ transformOrigin: "center center" }}
        transition={{
          type: "tween",
          duration: 0.32,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        {/* Header bar */}
        <header className="xmrp__head">
          <div className="xmrp__head-l">
            <Label size="micro" tone="cyan">
              MRP · {String(mrp.sequence).padStart(4, "0")}
            </Label>
            <span className="xmrp__head-divider" />
            <Label size="micro" tone="muted">
              {formatStamp(mrp.timestamp)}
            </Label>
            <StatusDot status={mrp.status} size="sm" label={mrp.status} />
          </div>
          <div className="xmrp__head-r">
            <Pill tone={mrp.external ? "violet" : "cyan"}>{mrp.model}</Pill>
            {mrp.tokens > 0 && <Pill>{formatTokens(mrp.tokens)} tok</Pill>}
            {mrp.parentId && <Pill tone="violet">branched</Pill>}
            <Button variant="ghost" size="sm" iconOnly onClick={onDismiss} aria-label="Close">
              <X />
            </Button>
          </div>
        </header>

        {/* 2-pane body — adds a third sidecar column when a section is popped out */}
        <div className="xmrp__body" data-sidecar={sidecarSection ?? "off"}>
          {/* Left: conversation */}
          <div className="xmrp__pane xmrp__pane--conv">
            <section className="xmrp__msg xmrp__msg--user">
              <div className="xmrp__msg-head">
                <Label size="micro" tone="amber">PROMPT</Label>
                <BrailleBand length={24} density={0.45} tone="amber" seed={mrp.sequence} />
              </div>
              <Markdown className="xmrp__msg-text" text={mrp.prompt} highlight={highlight} />
            </section>

            <section className="xmrp__msg xmrp__msg--assistant">
              <div className="xmrp__msg-head">
                <Label size="micro" tone="cyan">RESPONSE</Label>
                <BrailleBand length={24} density={0.55} tone="cyan" seed={mrp.sequence + 100} />
              </div>
              {mrp.response ? (
                <Markdown className="xmrp__msg-text" text={mrp.response} highlight={highlight} />
              ) : (
                <p className="xmrp__msg-text">(no response yet)</p>
              )}
            </section>
          </div>

          {/* Sidecar: full-list view popped out of the right pane. Sits
              between conversation and right-pane so the user reads
              prompt/response AND the list at the same time. */}
          <AnimatePresence>
            {sidecarSection && (
              <TelemetrySidecar
                key={sidecarSection}
                section={sidecarSection}
                items={sidecarSection === "tools" ? telemetry.tools : telemetry.files}
                onClose={() => setSidecarSection(null)}
              />
            )}
          </AnimatePresence>

          {/* Right: call telemetry */}
          <aside className="xmrp__pane xmrp__pane--tele">
            <TelemetrySection
              icon={<Zap />}
              label="Call Stats"
              items={telemetry.stats}
            />
            <TelemetrySection
              icon={<Wrench />}
              label="Tool Calls"
              items={telemetry.tools}
              grow
              popOutActive={sidecarSection === "tools"}
              onPopOut={() => togglePopOut("tools")}
            />
            <TelemetrySection
              icon={<FileText />}
              label="Files Touched"
              items={telemetry.files}
              grow
              popOutActive={sidecarSection === "files"}
              onPopOut={() => togglePopOut("files")}
            />
          </aside>
        </div>

        {/* Footer */}
        <footer className="xmrp__foot">
          <Label size="micro" tone="muted">
            {mrp.parentId
              ? `↳ branched from ${mrp.parentId.replace("mrp-", "")}`
              : "trunk"}
          </Label>
          <Label size="micro" tone="muted">
            ESC · CLICK BACKDROP · or X to close
          </Label>
        </footer>
      </motion.div>
    </div>
  );
}

/* ── Highlighted text ─────────────────────────────────────────────────── */
/** Wraps every case-insensitive occurrence of `query` in `text` with a
 *  styled <mark>. Returns the original text unchanged when query is empty
 *  or doesn't match. Escapes regex metachars so user search like "(a+b)"
 *  doesn't blow up. */
/* ── Telemetry section ────────────────────────────────────────────────── */
type TelemetryItem = {
  label: string;
  value: string;
  tone?: "cyan" | "violet" | "amber" | "muted";
  /** Full untruncated text shown on hover. Tool-call rows fill this with
   *  the complete args dump so long file paths / strings are readable. */
  title?: string;
};

function TelemetrySection({
  icon,
  label,
  items,
  grow,
  onPopOut,
  popOutActive,
}: {
  icon: React.ReactNode;
  label: string;
  items: TelemetryItem[];
  /** When true, the section flex-grows to fill remaining pane height and
   *  its inner list becomes the scroll container (instead of a fixed
   *  220px cap). Used for the Tool Calls section, where long runs were
   *  effectively invisible past ~2 rows. */
  grow?: boolean;
  /** When provided, the section header becomes a toggle for a floating
   *  sidecar pane instead of a native <details> open/close. Used when
   *  the right-pane real estate is too cramped to show the full list. */
  onPopOut?: () => void;
  /** True when this section is currently mirrored in the sidecar.
   *  Suppresses the inline list and lights the header with active-glow. */
  popOutActive?: boolean;
}) {
  // When the section is popped out, render a compact button-style header
  // and skip the inline list. Otherwise fall through to the standard
  // <details>-based section so plain Call Stats stays unchanged.
  if (onPopOut) {
    return (
      <div
        className={cn(
          "xmrp-tele",
          "xmrp-tele--button",
          popOutActive && "xmrp-tele--popped",
        )}
      >
        <button
          type="button"
          className="xmrp-tele__sum xmrp-tele__sum--button"
          onClick={onPopOut}
          aria-pressed={popOutActive}
          aria-label={popOutActive ? `Close ${label} sidecar` : `Open ${label} sidecar`}
        >
          <span className="xmrp-tele__icon">{icon}</span>
          <Label size="micro" tone="ink">{label}</Label>
          <ArrowLeftToLine
            className={cn("xmrp-tele__pop", popOutActive && "xmrp-tele__pop--active")}
          />
          <span className="xmrp-tele__count fx-mono-micro">{items.length}</span>
        </button>
      </div>
    );
  }
  return (
    <details className={cn("xmrp-tele", grow && "xmrp-tele--grow")} open>
      <summary className="xmrp-tele__sum">
        <span className="xmrp-tele__icon">{icon}</span>
        <Label size="micro" tone="ink">{label}</Label>
        <ChevronRight className="xmrp-tele__chev" />
        <span className="xmrp-tele__count fx-mono-micro">{items.length}</span>
      </summary>
      <ul className="xmrp-tele__list">
        {items.length === 0 && (
          <li className="xmrp-tele__empty fx-mono-micro">— none —</li>
        )}
        {items.map((item, i) => (
          <li key={i} className="xmrp-tele__row" title={item.title ?? `${item.label} = ${item.value}`}>
            <span className="xmrp-tele__label fx-mono-micro">{item.label}</span>
            <span className={cn("xmrp-tele__val", item.tone && `xmrp-tele__val--${item.tone}`)}>
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ── Sidecar pane ─────────────────────────────────────────────────────
   Pops one telemetry list out of the cramped right pane into a wider
   middle column. Conversation pane shrinks, right pane keeps its
   collapsed-button headers as breadcrumbs. */
function TelemetrySidecar({
  section,
  items,
  onClose,
}: {
  section: SidecarSection;
  items: TelemetryItem[];
  onClose: () => void;
}) {
  const title = section === "tools" ? "Tool Calls" : "Files Touched";
  const icon = section === "tools" ? <Wrench /> : <FileText />;
  return (
    <motion.aside
      className="xmrp__pane xmrp__pane--sidecar"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="xmrp-sidecar__head">
        <span className="xmrp-tele__icon">{icon}</span>
        <Label size="micro" tone="cyan">{title}</Label>
        <span className="xmrp-tele__count fx-mono-micro">{items.length}</span>
        <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label={`Close ${title}`}>
          <X />
        </Button>
      </header>
      <ul className="xmrp-sidecar__list">
        {items.length === 0 && (
          <li className="xmrp-tele__empty fx-mono-micro">— none —</li>
        )}
        {items.map((item, i) => (
          <li
            key={i}
            className="xmrp-tele__row xmrp-sidecar__row"
            title={item.title ?? `${item.label} = ${item.value}`}
          >
            <span className="xmrp-tele__label fx-mono-micro">{item.label}</span>
            <span className={cn("xmrp-tele__val", item.tone && `xmrp-tele__val--${item.tone}`)}>
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </motion.aside>
  );
}

/* ── Real telemetry from snapshot.events + modelRuns ──────────────────
   Tools list is folded from this MRP's tool_call_started events (the
   adapter for canvas chips uses the same source, so the count here and
   the chip count agree). Stats are pulled from the live ModelRun when
   one exists. Files Touched stays empty until we plumb tool_result
   paths through summary mode — clearly empty beats fake. */
type ServerModelRun = {
  mrpId: string;
  model?: string;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  timingMs?: number;
  finishReason?: string;
};

function realTelemetry(
  mrp: MRP,
  serverMrpId: string | undefined,
  events: MrpEvent[],
  modelRuns: ServerModelRun[],
): {
  stats: TelemetryItem[];
  tools: TelemetryItem[];
  files: TelemetryItem[];
} {
  // Find the latest model run for this MRP (placement.mrpId, not the
  // CanvasObject id, which is the placement id).
  const run = serverMrpId
    ? modelRuns.find((r) => r.mrpId === serverMrpId)
    : undefined;
  const tokIn = run?.promptTokens ?? Math.floor(mrp.tokens * 0.35) ?? 0;
  const tokOut = run?.completionTokens ?? Math.floor(mrp.tokens * 0.65) ?? 0;

  const stats: TelemetryItem[] = [
    { label: "model", value: run?.model ?? mrp.model, tone: "cyan" },
    ...(run?.timingMs !== undefined
      ? [{ label: "latency", value: `${run.timingMs}ms`, tone: "amber" as const }]
      : []),
    { label: "tok in", value: formatTokens(tokIn) },
    { label: "tok out", value: formatTokens(tokOut) },
    { label: "total", value: formatTokens(run?.totalTokens ?? mrp.tokens) },
    ...(run?.finishReason
      ? [{ label: "finish", value: run.finishReason }]
      : []),
  ];

  const tools: TelemetryItem[] = serverMrpId
    ? foldToolCallsFromEvents(events, serverMrpId)
    : [];

  const files: TelemetryItem[] = serverMrpId
    ? foldFilesFromEvents(events, serverMrpId)
    : [];

  return { stats, tools, files };
}

/** Fold tool_call_started events into one TelemetryItem per unique
 *  toolCall.id. Label = tool name; value = a short args summary or the
 *  status if no args. Pi's "tool-unknown" placeholders (from raw delta
 *  events) get filtered the same way the chip adapter does. */
function foldToolCallsFromEvents(
  events: MrpEvent[],
  mrpId: string,
): TelemetryItem[] {
  const seen = new Map<string, TelemetryItem>();
  for (const ev of events) {
    if (ev.mrpId !== mrpId) continue;
    if (ev.type !== "tool_call_started") continue;
    const payload = ev.payload as {
      toolCall?: { id?: string; name?: string; args?: unknown };
    };
    const tc = payload.toolCall;
    if (!tc?.id || tc.id === "tool-unknown") continue;
    if (seen.has(tc.id)) continue;
    const fullArgs = fullArgsText(tc.args);
    seen.set(tc.id, {
      label: tc.name ?? "tool",
      value: summarizeArgs(tc.args) ?? "—",
      tone: tc.name?.startsWith("mandrel_") || tc.name === "smart_search"
        ? "violet"
        : undefined,
      title: fullArgs ? `${tc.name ?? "tool"}\n${fullArgs}` : tc.name,
    });
  }
  return [...seen.values()];
}

/** Fold tool_result_completed events into one row per unique file path.
 *  Joins each result back to its tool_call_started by toolCallId to get
 *  the file path from the original args (results don't carry args). Only
 *  file-touching tools count (read/edit/write/multiedit/notebookedit —
 *  lowercase Pi naming, also tolerant of Claude's PascalCase). If any op
 *  on a given path errored, the row is toned red. Multi-op paths get a
 *  "N× tool" label so heavy editing is visible at a glance. */
const FILE_TOOLS = new Set([
  "read", "edit", "write", "multiedit", "notebookedit",
]);

function foldFilesFromEvents(
  events: MrpEvent[],
  mrpId: string,
): TelemetryItem[] {
  // First pass: index started calls by toolCallId so we can resolve
  // file paths from result events (results don't carry args).
  const startedById = new Map<string, { name: string; path: string }>();
  for (const ev of events) {
    if (ev.mrpId !== mrpId) continue;
    if (ev.type !== "tool_call_started") continue;
    const payload = ev.payload as {
      toolCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    };
    const tc = payload.toolCall;
    if (!tc?.id || tc.id === "tool-unknown") continue;
    if (!tc.name || !FILE_TOOLS.has(tc.name.toLowerCase())) continue;
    const path = extractFilePath(tc.args);
    if (!path) continue;
    startedById.set(tc.id, { name: tc.name, path });
  }

  // Second pass: walk results in order, accumulate per-path stats.
  type PerFile = { name: string; ops: number; errored: boolean };
  const perFile = new Map<string, PerFile>();
  for (const ev of events) {
    if (ev.mrpId !== mrpId) continue;
    if (ev.type !== "tool_result_completed") continue;
    const payload = ev.payload as {
      toolResult?: { toolCallId?: string; isError?: boolean };
    };
    const tr = payload.toolResult;
    if (!tr?.toolCallId) continue;
    const started = startedById.get(tr.toolCallId);
    if (!started) continue;
    const entry = perFile.get(started.path) ?? {
      name: started.name,
      ops: 0,
      errored: false,
    };
    entry.ops += 1;
    if (tr.isError) entry.errored = true;
    // Latest op's tool name wins so the label reflects the most
    // recent action (e.g. read-then-edit shows as "edit").
    entry.name = started.name;
    perFile.set(started.path, entry);
  }

  return [...perFile.entries()].map(([path, info]) => ({
    label: info.ops > 1 ? `${info.ops}× ${info.name}` : info.name,
    value: basename(path),
    title: path,
    tone: info.errored ? ("amber" as const) : undefined,
  }));
}

function extractFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  for (const key of ["file_path", "path", "notebook_path"]) {
    const v = a[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function basename(path: string): string {
  const last = path.split("/").filter(Boolean).pop();
  return last ?? path;
}

/** Full args dump for hover tooltips — every key, untruncated values,
 *  one per line. Returns undefined for missing/empty args. */
function fullArgsText(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  return entries
    .map(([k, v]) => {
      if (typeof v === "string") return `${k} = ${v}`;
      if (typeof v === "number" || typeof v === "boolean") return `${k} = ${v}`;
      try {
        return `${k} = ${JSON.stringify(v)}`;
      } catch {
        return `${k} = …`;
      }
    })
    .join("\n");
}

function summarizeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  return entries
    .slice(0, 2)
    .map(([k, v]) => {
      if (typeof v === "string") {
        return `${k}=${v.length > 28 ? v.slice(0, 28) + "…" : v}`;
      }
      if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return `${k}=…`;
    })
    .join(" ");
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date} · ${hh}:${mm}`;
}
