import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Wrench, FileText, Zap, ChevronRight } from "lucide-react";
import { useCanvas, type MRP } from "../../lib/store";
import { Pill } from "../primitives/Pill";
import { Label } from "../primitives/Label";
import { Button } from "../primitives/Button";
import { StatusDot } from "../primitives/StatusDot";
import { BrailleBand } from "../effects/BrailleBand";
import { cn } from "../../lib/cn";
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

function ExpandedMRP({ mrp, onDismiss }: { mrp: MRP; onDismiss: () => void }) {
  const telemetry = mockTelemetry(mrp);

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

        {/* 2-pane body */}
        <div className="xmrp__body">
          {/* Left: conversation */}
          <div className="xmrp__pane xmrp__pane--conv">
            <section className="xmrp__msg xmrp__msg--user">
              <div className="xmrp__msg-head">
                <Label size="micro" tone="amber">PROMPT</Label>
                <BrailleBand length={24} density={0.45} tone="amber" seed={mrp.sequence} />
              </div>
              <p className="xmrp__msg-text">{mrp.prompt}</p>
            </section>

            <section className="xmrp__msg xmrp__msg--assistant">
              <div className="xmrp__msg-head">
                <Label size="micro" tone="cyan">RESPONSE</Label>
                <BrailleBand length={24} density={0.55} tone="cyan" seed={mrp.sequence + 100} />
              </div>
              <p className="xmrp__msg-text">{mrp.response || "(no response yet)"}</p>
            </section>
          </div>

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
            />
            <TelemetrySection
              icon={<FileText />}
              label="Files Touched"
              items={telemetry.files}
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

/* ── Telemetry section ────────────────────────────────────────────────── */
type TelemetryItem = { label: string; value: string; tone?: "cyan" | "violet" | "amber" | "muted" };

function TelemetrySection({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: TelemetryItem[];
}) {
  return (
    <details className="xmrp-tele" open>
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
          <li key={i} className="xmrp-tele__row">
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

/* ── Mocked telemetry (deterministic per MRP via sequence/id) ─────────── */
function mockTelemetry(mrp: MRP): {
  stats: TelemetryItem[];
  tools: TelemetryItem[];
  files: TelemetryItem[];
} {
  const seed = mrp.sequence;
  const latencyMs = 240 + (seed * 73) % 800;
  const tokIn = Math.floor(mrp.tokens * 0.35) || 240;
  const tokOut = Math.floor(mrp.tokens * 0.65) || 600;
  const cost = (tokIn * 0.000015 + tokOut * 0.000075).toFixed(4);

  const stats: TelemetryItem[] = [
    { label: "model",    value: mrp.model, tone: "cyan" },
    { label: "latency",  value: `${latencyMs}ms`, tone: "amber" },
    { label: "tok in",   value: formatTokens(tokIn) },
    { label: "tok out",  value: formatTokens(tokOut) },
    { label: "cost",     value: `$${cost}` },
    { label: "thread",   value: mrp.parentId ? "branched" : "trunk", tone: mrp.parentId ? "violet" : "muted" },
  ];

  // Tool calls — varies by sequence to feel realistic
  const allTools = [
    { label: "Read", value: "src/lib/store.ts" },
    { label: "Edit", value: "src/components/canvas/Canvas.tsx" },
    { label: "Bash", value: "git status" },
    { label: "Grep", value: "MRP layoutId" },
    { label: "Write", value: "src/lib/layout.ts" },
  ];
  const toolCount = (seed * 3) % 4;
  const tools: TelemetryItem[] = allTools.slice(0, toolCount);

  // Files touched
  const allFiles = [
    { label: "M", value: "src/lib/store.ts", tone: "amber" as const },
    { label: "M", value: "src/components/canvas/MRPCard.tsx", tone: "amber" as const },
    { label: "+", value: "src/lib/layout.ts", tone: "cyan" as const },
    { label: "M", value: "src/components/canvas/Canvas.tsx", tone: "amber" as const },
  ];
  const fileCount = Math.max(1, (seed * 2) % 4);
  const files: TelemetryItem[] = allFiles.slice(0, fileCount);

  return { stats, tools, files };
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
