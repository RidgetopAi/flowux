import { useEffect, useRef } from "react";
import { motion, useMotionValue, type PanInfo } from "motion/react";
import { History, ListChecks, Sparkles, FileText as FileIcon, HelpCircle, Edit3 } from "lucide-react";
import { useCanvas, type StateObject } from "../../lib/store";
import { Card } from "../primitives/Card";
import { Label } from "../primitives/Label";
import { Pill } from "../primitives/Pill";
import { BrailleBand } from "../effects/BrailleBand";
import { cn } from "../../lib/cn";
import "./StateCard.css";

type Props = { state: StateObject };

/**
 * STATE card — first-class canvas tile for a compaction snapshot.
 *
 * Renders the structured state document (summary + goals + decisions +
 * facts + artifacts + open questions) at the position where the
 * compaction's covered-range MRPs are. Cool phosphor styling, distinct
 * from MRP cards (cyan accent border + braille band), with a version
 * pill and a "covers turns N-M" badge so the user can map snapshot ↔
 * raw cards spatially.
 *
 * Inactive (historic) snapshots render dimmer — only the active
 * snapshot drives current context. Click to scroll inside; full read
 * view + editing land in v3.
 */
export function StateCard({ state }: Props) {
  const draggingId = useCanvas((s) => s.draggingId);
  const cursorId = useCanvas((s) => s.cursorId);
  const moveObject = useCanvas((s) => s.moveObject);
  const setDragging = useCanvas((s) => s.setDragging);
  const setCursor = useCanvas((s) => s.setCursor);

  const isDragging = draggingId === state.id;
  const isCursor = cursorId === state.id;

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => () => undefined, []);

  const onDragStart = () => {
    setDragging(state.id);
    setCursor(state.id);
  };

  const onDragEnd = (_e: PointerEvent, info: PanInfo) => {
    moveObject(state.id, state.x + info.offset.x, state.y + info.offset.y);
    x.set(0);
    y.set(0);
    setDragging(null);
  };

  const onTap = () => {
    setCursor(state.id);
  };

  const doc = state.state;
  const activeGoals = doc.goals.filter((g) => g.status !== "done");
  const doneGoals = doc.goals.filter((g) => g.status === "done");
  const totalItems =
    activeGoals.length + doc.decisions.length + doc.facts.length + doc.artifacts.length + doc.openQuestions.length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: state.active ? 1 : 0.65, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={!isDragging
        ? { y: -3, transition: { duration: 0.18, ease: "easeOut" } }
        : undefined}
      style={{
        position: "absolute",
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
        zIndex: isDragging ? 30 : 6,
      }}
      data-object-id={state.id}
      className={cn(
        "state-card-wrap",
        isDragging && "is-dragging",
        state.active ? "is-active" : "is-historic",
      )}
    >
      <motion.div
        data-canvas-card
        data-dragging={isDragging ? "true" : undefined}
        data-cursor={isCursor ? "true" : undefined}
        drag
        dragMomentum={false}
        dragElastic={0}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onTap={onTap}
        whileDrag={{
          scale: 1.02,
          rotate: -0.5,
          transition: { duration: 0.14, ease: "easeOut" },
        }}
        style={{ x, y, height: "100%" }}
        className="state-card-drag-layer"
      >
        <Card state="idle" className="state-card">
          <div className="state-card__head">
            <Label tone="cyan" size="micro">STATE</Label>
            <Pill tone="cyan">v{state.version}</Pill>
            <Pill tone={state.active ? "cyan" : "neutral"}>
              {state.coveredCount} turn{state.coveredCount === 1 ? "" : "s"}
            </Pill>
            <span className="state-card__head-divider" />
            <Label size="micro" tone="muted">
              {`#${state.coveredFromSeq}–${state.coveredToSeq}`}
            </Label>
            {state.editedByUser && (
              <span className="state-card__edited" title="Edited by user">
                <Edit3 size={11} />
              </span>
            )}
            <span className="state-card__spacer" />
            {!state.active && (
              <Pill tone="neutral">historic</Pill>
            )}
          </div>

          <BrailleBand length={36} density={0.5} tone="cyan" seed={state.version + 99} />

          <div className="state-card__body">
            <p className="state-card__summary">
              {doc.summary || <em className="state-card__empty">no summary yet</em>}
            </p>

            {activeGoals.length > 0 && (
              <Section icon={<ListChecks size={12} />} label="Active Goals" count={activeGoals.length}>
                <ul className="state-card__list">
                  {activeGoals.map((g, i) => (
                    <li key={i} className={cn("state-card__row", g.status === "blocked" && "is-blocked")}>
                      <span className="state-card__dot" />
                      <span className="state-card__row-text">{g.text}</span>
                      {g.status === "blocked" && <Pill tone="amber">blocked</Pill>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {doc.decisions.length > 0 && (
              <Section icon={<Sparkles size={12} />} label="Decisions" count={doc.decisions.length}>
                <ul className="state-card__list">
                  {doc.decisions.map((d, i) => (
                    <li key={i} className="state-card__row state-card__row--decision">
                      <span className="state-card__row-text">
                        <strong>{d.what}</strong>
                        <span className="state-card__why"> — because {d.why}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {doc.facts.length > 0 && (
              <Section icon={<History size={12} />} label="Facts learned" count={doc.facts.length}>
                <ul className="state-card__list">
                  {doc.facts.map((f, i) => (
                    <li key={i} className="state-card__row">
                      <span className="state-card__dot" />
                      <span className="state-card__row-text">{f.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {doc.artifacts.length > 0 && (
              <Section icon={<FileIcon size={12} />} label="Artifacts" count={doc.artifacts.length}>
                <ul className="state-card__list">
                  {doc.artifacts.map((a, i) => (
                    <li key={i} className="state-card__row">
                      <span className="state-card__kind">{a.kind}</span>
                      <span className="state-card__row-text">
                        <code>{a.identifier}</code>
                        <span className="state-card__why"> — {a.role}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {doc.openQuestions.length > 0 && (
              <Section icon={<HelpCircle size={12} />} label="Open questions" count={doc.openQuestions.length}>
                <ul className="state-card__list">
                  {doc.openQuestions.map((q, i) => (
                    <li key={i} className="state-card__row state-card__row--question">
                      <span className="state-card__dot state-card__dot--amber" />
                      <span className="state-card__row-text">{q.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {totalItems === 0 && !doc.summary && (
              <p className="state-card__empty">
                Empty state — the conversation hadn't crystallized into goals or
                decisions yet when this snapshot was taken.
              </p>
            )}

            {doneGoals.length > 0 && (
              <div className="state-card__done">
                {doneGoals.length} resolved goal{doneGoals.length === 1 ? "" : "s"} archived in this snapshot.
              </div>
            )}
          </div>

          <footer className="state-card__foot">
            <Label size="micro" tone="muted">{state.generatedBy}</Label>
            <Label size="micro" tone="muted">{formatStamp(state.generatedAt)}</Label>
          </footer>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function Section({
  icon,
  label,
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="state-card__section">
      <div className="state-card__section-head">
        <span className="state-card__section-icon">{icon}</span>
        <Label size="micro" tone="ink">{label}</Label>
        <span className="state-card__section-count fx-mono-micro">{count}</span>
      </div>
      {children}
    </section>
  );
}

function formatStamp(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${date} · ${hh}:${mm}`;
  } catch {
    return iso;
  }
}
