import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  ListChecks,
  Sparkles,
  FileText as FileIcon,
  HelpCircle,
  History as HistoryIcon,
  Edit3,
  Save,
  RotateCcw,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  StateArtifact,
  StateArtifactKind,
  StateDecision,
  StateDocument,
  StateFact,
  StateGoalStatus,
  StateOpenQuestion,
} from "@flowux/shared";
import { useCanvas, type StateObject } from "../../lib/store";
import { useFlowuxStore } from "../../store.js";
import { Pill } from "../primitives/Pill";
import { Label } from "../primitives/Label";
import { Button } from "../primitives/Button";
import { BrailleBand } from "../effects/BrailleBand";
import { cn } from "../../lib/cn";
import "./ExpandedState.css";

/**
 * Full-screen overlay for a STATE snapshot — the user's primary surface
 * for reading and correcting compaction output.
 *
 * Read mode: clean structured layout, plenty of breathing room,
 * sections in priority order (summary → active goals → decisions → facts
 * → artifacts → open questions → done goals at the bottom).
 *
 * Edit mode: every field becomes a textarea, lists gain add/remove
 * buttons, save persists via the snapshot PATCH endpoint and sets
 * editedByUser = true on the row. Cancel reverts unsaved changes.
 *
 * Dismiss: Esc, X, or click backdrop.
 */
export function ExpandedStateLayer() {
  const expandedId = useCanvas((s) => s.expandedId);
  const state = useCanvas((s) => {
    if (!s.expandedId) return undefined;
    const obj = s.objects.find((o) => o.id === s.expandedId);
    return obj && obj.type === "state" ? obj : undefined;
  });
  const setExpanded = useCanvas((s) => s.setExpanded);

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
      {expandedId && state && (
        <ExpandedState key={expandedId} state={state} onDismiss={() => setExpanded(null)} />
      )}
    </AnimatePresence>
  );
}

function ExpandedState({ state, onDismiss }: { state: StateObject; onDismiss: () => void }) {
  const saveStateSnapshotEdit = useFlowuxStore((s) => s.saveStateSnapshotEdit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StateDocument>(state.state);
  const [saving, setSaving] = useState(false);

  /* Re-baseline draft when the underlying snapshot ref changes (e.g.
   *  after a save round-trip). Only when not actively editing — we don't
   *  want a server reload to blow away in-flight edits. */
  useEffect(() => {
    if (!editing) setDraft(state.state);
  }, [state.state, editing]);

  const enterEdit = () => setEditing(true);
  const cancelEdit = () => {
    setDraft(state.state);
    setEditing(false);
  };
  const save = async () => {
    setSaving(true);
    /* Send the full document so the server doesn't have to diff. Cheap
     *  enough for v1 — snapshots are small. */
    await saveStateSnapshotEdit(state.snapshotId, {
      summary: draft.summary,
      goals: draft.goals,
      decisions: draft.decisions,
      artifacts: draft.artifacts,
      facts: draft.facts,
      openQuestions: draft.openQuestions,
    });
    setSaving(false);
    setEditing(false);
  };

  const doc = editing ? draft : state.state;
  const activeGoals = useMemo(() => doc.goals.filter((g) => g.status !== "done"), [doc.goals]);
  const doneGoals = useMemo(() => doc.goals.filter((g) => g.status === "done"), [doc.goals]);

  return (
    <div className="xstate-portal">
      <motion.div
        className="xstate-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onClick={onDismiss}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className={cn("xstate", state.active ? "xstate--active" : "xstate--historic")}
        transition={{ type: "tween", duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className="xstate__head">
          <div className="xstate__head-l">
            <Label size="micro" tone="cyan">STATE SNAPSHOT</Label>
            <Pill tone="cyan">v{state.version}</Pill>
            <Pill tone={state.active ? "cyan" : "neutral"}>
              {state.coveredCount} turn{state.coveredCount === 1 ? "" : "s"}
            </Pill>
            <span className="xstate__head-divider" />
            <Label size="micro" tone="muted">
              {`covers #${state.coveredFromSeq}–${state.coveredToSeq}`}
            </Label>
            {state.editedByUser && (
              <Pill tone="amber">edited</Pill>
            )}
            {!state.active && <Pill tone="neutral">historic</Pill>}
          </div>
          <div className="xstate__head-r">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                  <RotateCcw size={14} /> Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
                  <Save size={14} /> {saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={enterEdit}>
                <Edit3 size={14} /> Edit
              </Button>
            )}
            <Button variant="ghost" size="sm" iconOnly onClick={onDismiss} aria-label="Close">
              <X />
            </Button>
          </div>
        </header>

        <BrailleBand length={48} density={0.5} tone="cyan" seed={state.version + 200} />

        <div className="xstate__body">
          {/* Summary */}
          <section className="xstate__section xstate__section--summary">
            <header className="xstate__section-head">
              <Label size="micro" tone="cyan">SUMMARY</Label>
              <BrailleBand length={32} density={0.42} tone="cyan" seed={state.version} />
            </header>
            {editing ? (
              <textarea
                className="xstate__field xstate__field--summary"
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="One- to two-sentence description of where the work stands."
                rows={3}
              />
            ) : (
              <p className="xstate__summary">
                {doc.summary || <em className="xstate__empty">no summary</em>}
              </p>
            )}
          </section>

          {/* Active Goals */}
          <ListSection
            icon={<ListChecks size={14} />}
            label="Active Goals"
            count={activeGoals.length}
            editing={editing}
            onAdd={() =>
              setDraft({
                ...draft,
                goals: [
                  ...draft.goals,
                  { text: "", status: "active", since: new Date().toISOString() },
                ],
              })
            }
          >
            {activeGoals.length === 0 && !editing && (
              <p className="xstate__empty xstate__empty--row">— none —</p>
            )}
            {(editing ? draft.goals : activeGoals).map((g, i) => {
              const idx = editing ? draft.goals.indexOf(g) : -1;
              return editing ? (
                <div key={idx} className="xstate__row xstate__row--edit">
                  <select
                    className="xstate__select"
                    value={g.status}
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "goals", idx, {
                        ...g,
                        status: e.target.value as StateGoalStatus,
                      })
                    }
                  >
                    <option value="active">active</option>
                    <option value="blocked">blocked</option>
                    <option value="done">done</option>
                  </select>
                  <textarea
                    className="xstate__field"
                    value={g.text}
                    rows={1}
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "goals", idx, { ...g, text: e.target.value })
                    }
                  />
                  <DeleteBtn
                    onClick={() => removeListItem(draft, setDraft, "goals", idx)}
                  />
                </div>
              ) : (
                <div key={i} className={cn("xstate__row", g.status === "blocked" && "is-blocked")}>
                  <span className="xstate__dot" />
                  <span className="xstate__row-text">{g.text}</span>
                  {g.status === "blocked" && <Pill tone="amber">blocked</Pill>}
                </div>
              );
            })}
          </ListSection>

          {/* Decisions */}
          <ListSection
            icon={<Sparkles size={14} />}
            label="Decisions"
            count={doc.decisions.length}
            editing={editing}
            onAdd={() =>
              setDraft({
                ...draft,
                decisions: [
                  ...draft.decisions,
                  { what: "", why: "", at: new Date().toISOString() } as StateDecision,
                ],
              })
            }
          >
            {doc.decisions.length === 0 && !editing && (
              <p className="xstate__empty xstate__empty--row">— none —</p>
            )}
            {doc.decisions.map((d, i) => {
              const idx = editing ? draft.decisions.indexOf(d) : -1;
              return editing ? (
                <div key={idx} className="xstate__row xstate__row--edit xstate__row--decision-edit">
                  <textarea
                    className="xstate__field"
                    value={d.what}
                    rows={1}
                    placeholder="What was decided"
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "decisions", idx, { ...d, what: e.target.value })
                    }
                  />
                  <textarea
                    className="xstate__field"
                    value={d.why}
                    rows={2}
                    placeholder="Why — the reasoning that should survive"
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "decisions", idx, { ...d, why: e.target.value })
                    }
                  />
                  <DeleteBtn
                    onClick={() => removeListItem(draft, setDraft, "decisions", idx)}
                  />
                </div>
              ) : (
                <div key={i} className="xstate__row xstate__row--decision">
                  <span className="xstate__dot" />
                  <span className="xstate__row-text">
                    <strong>{d.what}</strong>
                    <span className="xstate__why"> — because {d.why}</span>
                  </span>
                </div>
              );
            })}
          </ListSection>

          {/* Facts */}
          <ListSection
            icon={<HistoryIcon size={14} />}
            label="Facts learned"
            count={doc.facts.length}
            editing={editing}
            onAdd={() =>
              setDraft({ ...draft, facts: [...draft.facts, { text: "" } as StateFact] })
            }
          >
            {doc.facts.length === 0 && !editing && (
              <p className="xstate__empty xstate__empty--row">— none —</p>
            )}
            {doc.facts.map((f, i) => {
              const idx = editing ? draft.facts.indexOf(f) : -1;
              return editing ? (
                <div key={idx} className="xstate__row xstate__row--edit">
                  <textarea
                    className="xstate__field"
                    value={f.text}
                    rows={1}
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "facts", idx, { ...f, text: e.target.value })
                    }
                  />
                  <DeleteBtn
                    onClick={() => removeListItem(draft, setDraft, "facts", idx)}
                  />
                </div>
              ) : (
                <div key={i} className="xstate__row">
                  <span className="xstate__dot" />
                  <span className="xstate__row-text">{f.text}</span>
                </div>
              );
            })}
          </ListSection>

          {/* Artifacts */}
          <ListSection
            icon={<FileIcon size={14} />}
            label="Artifacts"
            count={doc.artifacts.length}
            editing={editing}
            onAdd={() =>
              setDraft({
                ...draft,
                artifacts: [
                  ...draft.artifacts,
                  { kind: "file", identifier: "", role: "" } as StateArtifact,
                ],
              })
            }
          >
            {doc.artifacts.length === 0 && !editing && (
              <p className="xstate__empty xstate__empty--row">— none —</p>
            )}
            {doc.artifacts.map((a, i) => {
              const idx = editing ? draft.artifacts.indexOf(a) : -1;
              return editing ? (
                <div key={idx} className="xstate__row xstate__row--edit xstate__row--artifact-edit">
                  <select
                    className="xstate__select"
                    value={a.kind}
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "artifacts", idx, {
                        ...a,
                        kind: e.target.value as StateArtifactKind,
                      })
                    }
                  >
                    <option value="file">file</option>
                    <option value="url">url</option>
                    <option value="concept">concept</option>
                    <option value="other">other</option>
                  </select>
                  <textarea
                    className="xstate__field"
                    value={a.identifier}
                    rows={1}
                    placeholder="Path / URL / name"
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "artifacts", idx, { ...a, identifier: e.target.value })
                    }
                  />
                  <textarea
                    className="xstate__field"
                    value={a.role}
                    rows={1}
                    placeholder="What this is in the conversation"
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "artifacts", idx, { ...a, role: e.target.value })
                    }
                  />
                  <DeleteBtn
                    onClick={() => removeListItem(draft, setDraft, "artifacts", idx)}
                  />
                </div>
              ) : (
                <div key={i} className="xstate__row">
                  <span className="xstate__kind">{a.kind}</span>
                  <span className="xstate__row-text">
                    <code>{a.identifier}</code>
                    <span className="xstate__why"> — {a.role}</span>
                  </span>
                </div>
              );
            })}
          </ListSection>

          {/* Open Questions */}
          <ListSection
            icon={<HelpCircle size={14} />}
            label="Open questions"
            count={doc.openQuestions.length}
            editing={editing}
            onAdd={() =>
              setDraft({
                ...draft,
                openQuestions: [
                  ...draft.openQuestions,
                  { text: "" } as StateOpenQuestion,
                ],
              })
            }
          >
            {doc.openQuestions.length === 0 && !editing && (
              <p className="xstate__empty xstate__empty--row">— none —</p>
            )}
            {doc.openQuestions.map((q, i) => {
              const idx = editing ? draft.openQuestions.indexOf(q) : -1;
              return editing ? (
                <div key={idx} className="xstate__row xstate__row--edit">
                  <textarea
                    className="xstate__field"
                    value={q.text}
                    rows={1}
                    onChange={(e) =>
                      updateListItem(draft, setDraft, "openQuestions", idx, { ...q, text: e.target.value })
                    }
                  />
                  <DeleteBtn
                    onClick={() => removeListItem(draft, setDraft, "openQuestions", idx)}
                  />
                </div>
              ) : (
                <div key={i} className="xstate__row xstate__row--question">
                  <span className="xstate__dot xstate__dot--amber" />
                  <span className="xstate__row-text">{q.text}</span>
                </div>
              );
            })}
          </ListSection>

          {/* Done goals collapsed at the bottom */}
          {doneGoals.length > 0 && !editing && (
            <details className="xstate__done">
              <summary>{doneGoals.length} resolved goal{doneGoals.length === 1 ? "" : "s"} (archived)</summary>
              {doneGoals.map((g, i) => (
                <div key={i} className="xstate__row xstate__row--done">
                  <span className="xstate__dot" />
                  <span className="xstate__row-text">{g.text}</span>
                </div>
              ))}
            </details>
          )}
        </div>

        <footer className="xstate__foot">
          <Label size="micro" tone="muted">{state.generatedBy}</Label>
          <Label size="micro" tone="muted">
            {state.editedByUser ? "edited · " : ""}
            generated {formatStamp(state.generatedAt)}
          </Label>
          <Label size="micro" tone="muted">ESC · CLICK BACKDROP · or X to close</Label>
        </footer>
      </motion.div>
    </div>
  );
}

function ListSection({
  icon,
  label,
  count,
  editing,
  onAdd,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  editing: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="xstate__section">
      <header className="xstate__section-head">
        <span className="xstate__section-icon">{icon}</span>
        <Label size="micro" tone="ink">{label}</Label>
        <span className="xstate__section-count fx-mono-micro">{count}</span>
        {editing && (
          <Button variant="ghost" size="sm" iconOnly onClick={onAdd} aria-label={`Add to ${label}`}>
            <Plus size={13} />
          </Button>
        )}
      </header>
      <div className="xstate__list">{children}</div>
    </section>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" iconOnly onClick={onClick} aria-label="Delete">
      <Trash2 size={13} />
    </Button>
  );
}

function updateListItem<K extends keyof StateDocument>(
  draft: StateDocument,
  setDraft: (next: StateDocument) => void,
  key: K,
  index: number,
  next: StateDocument[K] extends Array<infer Item> ? Item : never,
) {
  const arr = [...(draft[key] as Array<unknown>)];
  arr[index] = next;
  setDraft({ ...draft, [key]: arr } as StateDocument);
}

function removeListItem<K extends keyof StateDocument>(
  draft: StateDocument,
  setDraft: (next: StateDocument) => void,
  key: K,
  index: number,
) {
  const arr = [...(draft[key] as Array<unknown>)];
  arr.splice(index, 1);
  setDraft({ ...draft, [key]: arr } as StateDocument);
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
