import { useEffect, useRef } from "react";
import { motion, useMotionValue, type PanInfo } from "motion/react";
import { Edit3 } from "lucide-react";
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
 * Rendered as a compact MRP-sized tile in amber (the same colour as the
 * compacted MRPs it covers, so the amber run + its STATE card read as
 * one unit: "this is the point the context was folded; everything amber
 * before it is tied to this card"). Shows a preview — summary, next
 * step, and a count strip — and opens the full structured read/edit
 * overlay on double-tap, exactly like an MRP card.
 */
export function StateCard({ state }: Props) {
  const draggingId = useCanvas((s) => s.draggingId);
  const cursorId = useCanvas((s) => s.cursorId);
  const moveObject = useCanvas((s) => s.moveObject);
  const setDragging = useCanvas((s) => s.setDragging);
  const setCursor = useCanvas((s) => s.setCursor);

  const setExpanded = useCanvas((s) => s.setExpanded);

  const isDragging = draggingId === state.id;
  const isCursor = cursorId === state.id;

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  /* Two-tap-to-expand mirrors MRPCard's pattern — single tap moves the
   *  cursor here (for keyboard nav), double-tap within 280ms opens the
   *  full read/edit overlay. */
  const tapTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    },
    [],
  );

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
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      setExpanded(state.id);
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
    }, 280);
  };

  const doc = state.state;
  const activeGoals = doc.goals.filter((g) => g.status !== "done");

  /* Compact count strip — only non-empty sections, so the user can see
   *  at a glance what's inside before expanding. */
  const stats: string[] = [];
  const push = (n: number, one: string, many = one + "s") => {
    if (n > 0) stats.push(`${n} ${n === 1 ? one : many}`);
  };
  push(activeGoals.length, "goal");
  push(doc.constraints?.length ?? 0, "constraint");
  push(doc.decisions.length, "decision");
  push(doc.facts.length, "fact");
  push(doc.rejected?.length ?? 0, "ruled out", "ruled out");
  push(doc.artifacts.length, "artifact");
  push(doc.openQuestions.length, "question");

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
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
      className={cn("state-card-wrap", isDragging && "is-dragging")}
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
            <Label tone="amber" size="micro">STATE</Label>
            <Pill tone="amber">v{state.version}</Pill>
            <Pill tone="amber">
              {state.coveredCount} turn{state.coveredCount === 1 ? "" : "s"}
            </Pill>
            <span className="state-card__spacer" />
            <Label size="micro" tone="muted">
              {`#${state.coveredFromSeq}–${state.coveredToSeq}`}
            </Label>
            {state.editedByUser && (
              <span className="state-card__edited" title="Edited by user">
                <Edit3 size={11} />
              </span>
            )}
          </div>

          <BrailleBand length={36} density={0.5} tone="amber" seed={state.version + 99} />

          <div className="state-card__body">
            <p className="state-card__summary">
              {doc.summary || <em className="state-card__empty">no summary yet</em>}
            </p>

            {doc.nextStep && (
              <p className="state-card__next">
                <span className="state-card__next-label">NEXT</span>
                {doc.nextStep}
              </p>
            )}

            {stats.length > 0 && (
              <div className="state-card__stats">{stats.join(" · ")}</div>
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
