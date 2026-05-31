export type CanvasStatus = "temporary" | "saved" | "archived";
export type MrpStatus = "pending" | "streaming" | "complete" | "error";
export type ContextMode = "full_mrp" | "summary" | "response_only" | "excerpt" | "none";
export type ArtifactType = "image" | "file" | "code" | "link" | "diff" | "terminal";
export type ModelProvider = "mock" | "llama_cpp" | "openai_compatible" | "pi_mono" | "codex" | "ampcode" | "squire";
export type HarnessMode = "direct_model" | "pi_mono" | "codex" | "ampcode" | "squire";
export type MrpSectionKind =
  | "prompt"
  | "response"
  | "context_sent"
  | "thinking"
  | "tool_calls"
  | "tool_results"
  | "files"
  | "artifacts"
  | "usage"
  | "timeline"
  | "errors"
  | "raw_events";
export type MrpBlockKind =
  | "text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "file_reference"
  | "artifact"
  | "usage"
  | "error"
  | "event";
export type ContextDefault = "include" | "exclude" | "summarize";

export interface ExecutionContext {
  harness: HarnessMode;
  hostLabel?: string;
  workspaceLabel?: string;
  filesystemScope?: string;
  toolCapabilities: string[];
  warning?: string;
}

export interface ContextBudget {
  estimatedTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  availableInputTokens: number;
  percentOfWindow: number;
  percentOfInputBudget: number;
  messageCount: number;
  mrpCount: number;
  currentPromptTokens: number;
  warning?: "ok" | "high" | "over";
}

export interface HealthStatus {
  ok: boolean;
  harnessMode: HarnessMode;
  modelMode: "mock" | "llama_cpp";
  modelBaseUrl: string;
  modelName: string;
  modelMaxTokens: number;
  piMonoCwd: string;
  piMonoProvider: string;
  piMonoModel: string;
  contextWindow: number;
  maxOutputTokens: number;
  executionContext: ExecutionContext;
}

export interface CanvasThread {
  id: string;
  title: string;
  status: CanvasStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  parentCanvasId?: string;
  parentBranchId?: string;
  summary?: string;
  modelConfigId?: string;
  /** Pointer to the currently authoritative state snapshot for this
   *  canvas. When set, context assembly uses snapshot + pinned + last
   *  workingSetSize raw turns. When null, behavior is unchanged (all
   *  selected MRPs ride along verbatim — today's baseline). */
  activeSnapshotId?: string;
  /** Number of most-recent non-pinned, non-compacted MRPs that ride
   *  verbatim in context after the snapshot prelude. Default 8. */
  workingSetSize?: number;
  /** Percent-of-context-window at which auto-compaction triggers
   *  (e.g. 75). null/undefined = manual /compact only. */
  autoCompactThreshold?: number;
}

export interface Mrp {
  id: string;
  canvasId: string;
  sequence: number;
  userPrompt: string;
  assistantResponse: string;
  title?: string;
  summary?: string;
  status: MrpStatus;
  createdAt: string;
  updatedAt: string;
  modelRunId?: string;
  /** User-pinned MRPs are exempt from compaction. They ALWAYS ride
   *  along verbatim in context after a snapshot prelude. Use this for
   *  cards that capture a load-bearing decision, a long-lived constraint,
   *  or anything you don't want the model to forget. */
  pinned?: boolean;
  /** When set, this MRP has been folded into the named state snapshot
   *  and no longer rides in context (the snapshot speaks for it). The
   *  MRP card stays on canvas — rendered muted — and remains drillable
   *  for inspection or retrieval. Cleared if a later snapshot revert
   *  un-covers it. */
  compactedBySnapshotId?: string;
  /** The MRP sequence at which compaction occurred — preserved so we
   *  can show "compacted at turn N" in the UI even if the MRP is later
   *  removed from a working set or shifted. */
  compactedAtSeq?: number;
}

export interface CanvasPlacement {
  id: string;
  canvasId: string;
  mrpId: string;
  originCanvasId?: string;
  isExternalReference: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  selectedForContext: boolean;
  connectionHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MrpSection {
  id: string;
  mrpId: string;
  kind: MrpSectionKind;
  title: string;
  summary?: string;
  sequence: number;
  collapsedByDefault: boolean;
  selectable: boolean;
  contextDefault: ContextDefault;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MrpBlock {
  id: string;
  mrpId: string;
  sectionId: string;
  kind: MrpBlockKind;
  sequence: number;
  content: Record<string, unknown>;
  selectable: boolean;
  tokenEstimate?: number;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MrpEvent {
  id: string;
  mrpId: string;
  modelRunId?: string;
  type: string;
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Branch {
  id: string;
  parentCanvasId: string;
  childCanvasId: string;
  sourceMrpIds: string[];
  createdAt: string;
  label?: string;
}

/* ── State snapshots (compaction memory model) ─────────────────────────
 * A state snapshot is a STRUCTURED summary of conversation state — not a
 * narrative blob. It captures goals, decisions (with WHY), facts learned,
 * artifacts in play, and open questions. Each compaction surgically
 * updates a prior snapshot; versions are kept so a compaction can be
 * rolled back. The snapshot is a first-class canvas object (rendered as
 * a STATE card) and is editable by the user. */

export type StateGoalStatus = "active" | "blocked" | "done";

export interface StateGoal {
  text: string;
  status: StateGoalStatus;
  /** ISO timestamp when the goal entered its current status. Lets the
   *  UI render "blocked since…" or "completed at…" without losing context. */
  since: string;
}

export interface StateDecision {
  /** The decision itself, in plain language. */
  what: string;
  /** Why it was made — the load-bearing part Claude Code's compact
   *  typically loses. Reasoning enables intelligent revisits. */
  why: string;
  /** Optional anchor back to the MRP where the decision crystallized. */
  mrpId?: string;
  at: string;
}

export type StateArtifactKind = "file" | "url" | "concept" | "other";

export interface StateArtifact {
  kind: StateArtifactKind;
  /** Stable identifier: file path, full URL, concept name, etc. */
  identifier: string;
  /** What this artifact is, in this conversation's context.
   *  E.g. "the main entry point we're refactoring" or "the spec we're following". */
  role: string;
}

/** How much we trust a fact. Distinguishing known from assumed stops a
 *  resuming model from acting on guesses as if they were established. */
export type StateFactConfidence = "known" | "assumed" | "needs_verification";

export interface StateFact {
  text: string;
  /** Defaults to "known" when omitted (back-compat with pre-confidence
   *  snapshots and with facts the model states plainly). */
  confidence?: StateFactConfidence;
  /** MRP IDs that established this fact — lets the UI jump back to the
   *  source turns if the user wants to verify or rehydrate context. */
  sources?: string[];
}

export interface StateOpenQuestion {
  text: string;
  raisedBy?: string;
}

/** A hard requirement or non-negotiable the user stated — preserved as
 *  close to verbatim as possible so it survives summarization intact. */
export interface StateConstraint {
  text: string;
  /** Optional MRP id where the constraint was stated. */
  source?: string;
}

/** Negative knowledge: an approach that was tried or considered and ruled
 *  out. Recording it stops the next agent from re-walking the dead end. */
export interface StateRejected {
  /** The approach that was ruled out. */
  approach: string;
  /** Why it was rejected — the reasoning that keeps it rejected. */
  why: string;
  /** Optional anchor back to the MRP where it was ruled out. */
  mrpId?: string;
}

/** The structured body of a state snapshot — the JSON the model is asked
 *  to produce + the user is allowed to edit. */
export interface StateDocument {
  /** One- to two-sentence "where we are right now" statement. */
  summary: string;
  /** The single most useful next action — what a resuming agent should do
   *  first. Empty string when there's no clear next step. */
  nextStep: string;
  goals: StateGoal[];
  /** Hard requirements / non-negotiables stated by the user. */
  constraints: StateConstraint[];
  decisions: StateDecision[];
  facts: StateFact[];
  /** Approaches tried or considered and ruled out (negative knowledge). */
  rejected: StateRejected[];
  artifacts: StateArtifact[];
  openQuestions: StateOpenQuestion[];
}

/** Coerce a possibly-partial state document (e.g. a snapshot written
 *  before these fields existed, or raw model output) into the full shape
 *  so consumers can rely on every field being present. */
export function normalizeStateDocument(doc: Partial<StateDocument> | null | undefined): StateDocument {
  return {
    summary: doc?.summary ?? "",
    nextStep: doc?.nextStep ?? "",
    goals: doc?.goals ?? [],
    constraints: doc?.constraints ?? [],
    decisions: doc?.decisions ?? [],
    facts: doc?.facts ?? [],
    rejected: doc?.rejected ?? [],
    artifacts: doc?.artifacts ?? [],
    openQuestions: doc?.openQuestions ?? []
  };
}

export type StateSnapshotTrigger = "user" | "auto" | "manual_edit";

export interface StateSnapshot {
  id: string;
  canvasId: string;
  /** Monotonic version per canvas (1, 2, 3, …). Latest version is the
   *  one canvas_threads.activeSnapshotId points to. */
  version: number;
  /** Prior version's id (null for the first snapshot of a canvas). */
  parentSnapshotId?: string;
  state: StateDocument;
  /** Model id that generated this snapshot (e.g. "xai/grok-4.3"). */
  generatedBy: string;
  generatedAt: string;
  triggeredBy: StateSnapshotTrigger;
  /** Explicit list of MRPs this snapshot covers, in sequence order.
   *  Sourcing this on the snapshot row (rather than deriving from
   *  mrps.compactedBySnapshotId) lets future versions diff cleanly. */
  coveredMrpIds: string[];
  coveredFromSeq: number;
  coveredToSeq: number;
  /** Spatial placement on the canvas — the STATE card has to live
   *  somewhere. Mirrors canvas_placements for MRPs. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Marks the snapshot as having been edited by the user (so the next
   *  compaction knows to treat it as a corrected baseline rather than
   *  re-summarize). */
  editedByUser: boolean;
  /** Optional edit trail for diagnostics. */
  editHistory?: Array<{ at: string; fieldPath: string }>;
}

export interface ContextBundle {
  id: string;
  canvasId: string;
  name?: string;
  selectedMrpIds: string[];
  modeByMrpId: Record<string, ContextMode>;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  mrpId: string;
  type: ArtifactType;
  name: string;
  uri: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UploadedAttachment {
  id: string;
  type: Extract<ArtifactType, "image" | "file" | "code">;
  name: string;
  uri: string;
  mimeType?: string;
  size: number;
  textPreview?: string;
  createdAt: string;
}

/** A free-floating ("parked") image placed directly on the canvas by the
 *  user — NOT tied to any MRP. It's a planning-surface object: it persists
 *  with the canvas (survives reload) but is only promoted to model context
 *  if the user drags it into the dock and sends. `uploadId` points at the
 *  same /api/uploads-backed file an MRP attachment would use, so promoting
 *  a parked image to a dock attachment reuses the upload (no re-upload). */
export interface CanvasImage {
  id: string;
  canvasId: string;
  uploadId: string;
  uri: string;
  name: string;
  mimeType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRun {
  id: string;
  canvasId: string;
  mrpId: string;
  provider: ModelProvider;
  model: string;
  inputMrpIds: string[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  timingMs?: number;
  finishReason?: string;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface TurnTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface FlowuxToolCall {
  id: string;
  name: string;
  args?: unknown;
  status?: "started" | "streaming" | "complete" | "error";
}

export interface FlowuxToolResult {
  toolCallId: string;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
}

export interface FlowuxFileReference {
  path: string;
  action?: "read" | "write" | "edit" | "delete" | "search" | "unknown";
  metadata?: Record<string, unknown>;
}

export type FlowuxTurnEvent =
  | { type: "turn_started"; raw?: unknown }
  | { type: "response_delta"; text: string; raw?: unknown }
  | { type: "thinking_delta"; text: string; raw?: unknown }
  | { type: "tool_call_started"; toolCall: FlowuxToolCall; raw?: unknown }
  | { type: "tool_call_delta"; toolCall: FlowuxToolCall; delta?: unknown; raw?: unknown }
  | { type: "tool_call_completed"; toolCall: FlowuxToolCall; raw?: unknown }
  | { type: "tool_result_delta"; toolResult: FlowuxToolResult; raw?: unknown }
  | { type: "tool_result_completed"; toolResult: FlowuxToolResult; raw?: unknown }
  | { type: "file_referenced"; file: FlowuxFileReference; raw?: unknown }
  | { type: "artifact_created"; artifact: Omit<Artifact, "id" | "mrpId" | "createdAt">; raw?: unknown }
  | { type: "usage"; usage: TurnTokenUsage; raw?: unknown }
  | { type: "raw_event"; eventType: string; raw: unknown }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "done"; finishReason?: string; raw?: unknown };

export interface CanvasSnapshot {
  canvas: CanvasThread;
  mrps: Mrp[];
  placements: CanvasPlacement[];
  modelRuns: ModelRun[];
  sections: MrpSection[];
  blocks: MrpBlock[];
  events: MrpEvent[];
  artifacts: Artifact[];
  /** Free-floating images parked on the canvas by the user (not MRP-bound). */
  canvasImages: CanvasImage[];
  branches: Branch[];
  contextBundles: ContextBundle[];
  /** Every state snapshot ever taken on this canvas, oldest → newest.
   *  The active one (if any) is canvas.activeSnapshotId. Older versions
   *  ride along so the UI can build a history sidebar without an extra
   *  fetch. */
  stateSnapshots: StateSnapshot[];
}

export interface MrpDetails {
  mrpId: string;
  modelRuns: ModelRun[];
  sections: MrpSection[];
  blocks: MrpBlock[];
  events: MrpEvent[];
  artifacts: Artifact[];
}

export type SearchResultKind = "canvas" | "mrp" | "artifact";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  canvasId: string;
  mrpId?: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface CreateChildCanvasResponse {
  canvas: CanvasThread;
  branch: Branch;
  placements: CanvasPlacement[];
}

export interface ImportExternalMrpsResponse {
  placements: CanvasPlacement[];
}

export interface CreatePromptRequest {
  canvasId: string;
  prompt: string;
  selectedMrpIds?: string[];
}

export interface CreatePromptResponse {
  mrp: Mrp;
  placement: CanvasPlacement;
  modelRun: ModelRun;
  contextBudget?: ContextBudget;
}

export interface ContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
  mrpId?: string;
}

export interface ContextEstimateResponse {
  canvasId: string;
  prompt: string;
  budget: ContextBudget;
}

export interface CompactCanvasRequest {
  /** Optional explicit MRP id list to compact. When omitted, the server
   *  picks everything between the last snapshot and (latest sequence
   *  − workingSetSize), exempting pinned MRPs. */
  mrpIds?: string[];
  /** "user" for manual /compact, "auto" for threshold-triggered. */
  trigger?: StateSnapshotTrigger;
}

export interface CompactCanvasResponse {
  snapshot: StateSnapshot;
  /** The MRPs that were folded into this snapshot (returned so the
   *  client can update its local state without a snapshot reload). */
  compactedMrpIds: string[];
  /** Updated canvas thread row (activeSnapshotId is now the new snapshot). */
  canvas: CanvasThread;
}
