import type {
  ContextBudget,
  ContextMessage,
  ContextMode,
  Mrp,
  StateDocument,
  StateSnapshot
} from "./types.js";
import { normalizeStateDocument } from "./types.js";

export interface BuildContextInput {
  mrps: Mrp[];
  selectedMrpIds: string[];
  modeByMrpId?: Record<string, ContextMode>;
  systemPrompt?: string;
  projectInstructions?: string;
  currentPrompt: string;
  /** Active state snapshot for this canvas, if compaction has been
   *  performed. When present, the snapshot is rendered as a structured
   *  prelude message right after the system prompt — replacing the raw
   *  turns it covers. */
  stateSnapshot?: StateSnapshot;
  /** Pinned MRPs are always included verbatim after the snapshot —
   *  exempt from compaction and from workingSetSize truncation. */
  pinnedMrpIds?: string[];
  /** When set, the non-pinned/non-snapshot-covered raw turns are
   *  truncated to the most-recent N. Only applied when stateSnapshot
   *  is also present (otherwise existing canvases would suddenly start
   *  losing context — bad). */
  workingSetSize?: number;
}

export function buildContextMessages(input: BuildContextInput): ContextMessage[] {
  const selected = new Set(input.selectedMrpIds);
  const pinned = new Set(input.pinnedMrpIds ?? []);
  const modes = input.modeByMrpId ?? {};
  const messages: ContextMessage[] = [];

  if (input.systemPrompt?.trim()) {
    messages.push({ role: "system", content: input.systemPrompt.trim() });
  }

  if (input.projectInstructions?.trim()) {
    messages.push({ role: "user", content: `Project instructions:\n${input.projectInstructions.trim()}` });
  }

  if (input.stateSnapshot) {
    messages.push({
      role: "user",
      content: renderStateSnapshotMarkdown(input.stateSnapshot)
    });
  }

  /* MRP filtering pipeline:
   *  1. Drop unselected.
   *  2. Drop covered-by-snapshot UNLESS the user explicitly checked them
   *     into the bundle (selectedForContext overrides compaction — "I
   *     want this in context right now") OR they're pinned.
   *  3. Sort by sequence.
   *  4. If a snapshot is active AND workingSetSize is set, cap the
   *     non-pinned tail. Pinned MRPs always pass through. */
  const coveredIds = new Set(input.stateSnapshot?.coveredMrpIds ?? []);
  let selectedMrps = input.mrps
    .filter((mrp) => selected.has(mrp.id))
    .filter((mrp) => {
      // Pinned + explicitly bundle-checked always ride.
      if (pinned.has(mrp.id)) return true;
      // Compacted (and not pinned, not explicitly re-selected via bundle UX)
      // ride only when the user hasn't compacted them away.
      if (coveredIds.has(mrp.id)) return false;
      return true;
    })
    .sort((a, b) => a.sequence - b.sequence);

  if (input.stateSnapshot && input.workingSetSize && input.workingSetSize > 0) {
    const pinnedHits = selectedMrps.filter((m) => pinned.has(m.id));
    const rest = selectedMrps.filter((m) => !pinned.has(m.id));
    const restTail = rest.slice(-input.workingSetSize);
    selectedMrps = [...pinnedHits, ...restTail].sort((a, b) => a.sequence - b.sequence);
  }

  for (const mrp of selectedMrps) {
    const mode = modes[mrp.id] ?? "full_mrp";
    if (mode === "none") continue;

    if (mode === "summary") {
      messages.push({
        role: "user",
        content: `Prior MRP ${mrp.sequence} summary:\n${mrp.summary ?? mrp.title ?? mrp.userPrompt}`,
        mrpId: mrp.id
      });
      continue;
    }

    messages.push({ role: "user", content: mrp.userPrompt, mrpId: mrp.id });

    if (mode === "response_only" || mode === "full_mrp") {
      messages.push({ role: "assistant", content: mrp.assistantResponse, mrpId: mrp.id });
    }
  }

  messages.push({ role: "user", content: input.currentPrompt });
  return messages;
}

/* ── Snapshot rendering ───────────────────────────────────────────────
 * Render the structured state document as markdown for injection into
 * model context. Markdown reads more naturally than JSON for the model,
 * and we keep the JSON as the source of truth in the DB. Done goals are
 * suppressed (no value re-listing completed work). */
export function renderStateSnapshotMarkdown(snapshot: StateSnapshot): string {
  return renderStateDocumentMarkdown(snapshot.state, {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    coveredRange: { from: snapshot.coveredFromSeq, to: snapshot.coveredToSeq }
  });
}

export function renderStateDocumentMarkdown(
  rawState: StateDocument,
  meta?: { version?: number; generatedAt?: string; coveredRange?: { from: number; to: number } }
): string {
  /* Normalize so a snapshot written before these fields existed renders
   *  without blowing up on a missing array. */
  const state = normalizeStateDocument(rawState);
  const lines: string[] = [];
  const header = meta?.version !== undefined
    ? `## State Snapshot (v${meta.version})`
    : "## State Snapshot";
  lines.push(header);

  if (meta?.coveredRange) {
    lines.push(
      `*Covers turns ${meta.coveredRange.from}–${meta.coveredRange.to}. Use this as the authoritative summary of earlier conversation; raw turns above this range have been compacted into this snapshot.*`
    );
  }
  lines.push("");
  lines.push(`**Where we are:** ${state.summary || "(no summary)"}`);

  if (state.nextStep.trim()) {
    lines.push("");
    lines.push(`**Next step:** ${state.nextStep.trim()}`);
  }

  if (state.constraints.length) {
    lines.push("");
    lines.push("**Constraints / non-negotiables (do not violate):**");
    for (const c of state.constraints) {
      lines.push(`- ${c.text}`);
    }
  }

  const activeGoals = state.goals.filter((g) => g.status !== "done");
  if (activeGoals.length) {
    lines.push("");
    lines.push("**Active goals:**");
    for (const g of activeGoals) {
      const since = g.since ? ` (${g.status} since ${shortDate(g.since)})` : "";
      lines.push(`- ${g.text}${since}`);
    }
  }

  if (state.decisions.length) {
    lines.push("");
    lines.push("**Decisions made:**");
    for (const d of state.decisions) {
      lines.push(`- **${d.what}** — *because* ${d.why}`);
    }
  }

  if (state.facts.length) {
    lines.push("");
    lines.push("**Key facts learned:**");
    for (const f of state.facts) {
      /* Flag anything not yet established so the model doesn't treat a
       *  guess as ground truth. */
      const tag =
        f.confidence === "assumed"
          ? " *(assumed — unverified)*"
          : f.confidence === "needs_verification"
            ? " *(needs verification)*"
            : "";
      lines.push(`- ${f.text}${tag}`);
    }
  }

  if (state.rejected.length) {
    lines.push("");
    lines.push("**Ruled out (do not retry without new reason):**");
    for (const r of state.rejected) {
      lines.push(`- **${r.approach}** — *rejected because* ${r.why}`);
    }
  }

  if (state.artifacts.length) {
    lines.push("");
    lines.push("**Artifacts in play:**");
    for (const a of state.artifacts) {
      lines.push(`- ${a.identifier} — ${a.role}`);
    }
  }

  if (state.openQuestions.length) {
    lines.push("");
    lines.push("**Open questions:**");
    for (const q of state.openQuestions) {
      lines.push(`- ${q.text}`);
    }
  }

  return lines.join("\n");
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function estimateContextBudget(input: {
  messages: ContextMessage[];
  contextWindow: number;
  maxOutputTokens: number;
  currentPrompt?: string;
}): ContextBudget {
  const estimatedTokens = input.messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
  const currentPromptTokens = estimateTokens(input.currentPrompt ?? input.messages.at(-1)?.content ?? "");
  const availableInputTokens = Math.max(0, input.contextWindow - input.maxOutputTokens);
  const percentOfWindow = input.contextWindow > 0 ? Math.round((estimatedTokens / input.contextWindow) * 1000) / 10 : 0;
  const percentOfInputBudget = availableInputTokens > 0 ? Math.round((estimatedTokens / availableInputTokens) * 1000) / 10 : 0;
  return {
    estimatedTokens,
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    availableInputTokens,
    percentOfWindow,
    percentOfInputBudget,
    messageCount: input.messages.length,
    mrpCount: new Set(input.messages.map((message) => message.mrpId).filter(Boolean)).size,
    currentPromptTokens,
    warning: percentOfInputBudget >= 100 ? "over" : percentOfInputBudget >= 80 ? "high" : "ok"
  };
}

export function estimateTokens(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}
