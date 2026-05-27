import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const canvasThreads = sqliteTable("canvas_threads", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", { enum: ["temporary", "saved", "archived"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at"),
  parentCanvasId: text("parent_canvas_id"),
  parentBranchId: text("parent_branch_id"),
  summary: text("summary"),
  modelConfigId: text("model_config_id"),
  activeSnapshotId: text("active_snapshot_id"),
  workingSetSize: integer("working_set_size"),
  autoCompactThreshold: integer("auto_compact_threshold")
});

export const mrps = sqliteTable("mrps", {
  id: text("id").primaryKey(),
  canvasId: text("canvas_id").notNull(),
  sequence: integer("sequence").notNull(),
  userPrompt: text("user_prompt").notNull(),
  assistantResponse: text("assistant_response").notNull(),
  title: text("title"),
  summary: text("summary"),
  status: text("status", { enum: ["pending", "streaming", "complete", "error"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  modelRunId: text("model_run_id"),
  pinned: integer("pinned", { mode: "boolean" }),
  compactedBySnapshotId: text("compacted_by_snapshot_id"),
  compactedAtSeq: integer("compacted_at_seq")
});

/* ── State snapshots ───────────────────────────────────────────────────
 * Structured compaction memory. One row per compaction; latest version
 * per canvas is the authoritative snapshot. `state` is the JSON body
 * (matches the StateDocument shared type). Versions are immutable except
 * for user-edits, which set editedByUser=true and append to editHistory. */
export const stateSnapshots = sqliteTable("state_snapshots", {
  id: text("id").primaryKey(),
  canvasId: text("canvas_id").notNull(),
  version: integer("version").notNull(),
  parentSnapshotId: text("parent_snapshot_id"),
  state: text("state", { mode: "json" }).$type<import("@flowux/shared").StateDocument>().notNull(),
  generatedBy: text("generated_by").notNull(),
  generatedAt: text("generated_at").notNull(),
  triggeredBy: text("triggered_by", { enum: ["user", "auto", "manual_edit"] }).notNull(),
  coveredMrpIds: text("covered_mrp_ids", { mode: "json" }).$type<string[]>().notNull(),
  coveredFromSeq: integer("covered_from_seq").notNull(),
  coveredToSeq: integer("covered_to_seq").notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  editedByUser: integer("edited_by_user", { mode: "boolean" }).notNull(),
  editHistory: text("edit_history", { mode: "json" }).$type<Array<{ at: string; fieldPath: string }>>()
});

export const canvasPlacements = sqliteTable("canvas_placements", {
  id: text("id").primaryKey(),
  canvasId: text("canvas_id").notNull(),
  mrpId: text("mrp_id").notNull(),
  originCanvasId: text("origin_canvas_id"),
  isExternalReference: integer("is_external_reference", { mode: "boolean" }).notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull(),
  selectedForContext: integer("selected_for_context", { mode: "boolean" }).notNull(),
  connectionHidden: integer("connection_hidden", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  parentCanvasId: text("parent_canvas_id").notNull(),
  childCanvasId: text("child_canvas_id").notNull(),
  sourceMrpIds: text("source_mrp_ids", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  label: text("label")
});

export const contextBundles = sqliteTable("context_bundles", {
  id: text("id").primaryKey(),
  canvasId: text("canvas_id").notNull(),
  name: text("name"),
  selectedMrpIds: text("selected_mrp_ids", { mode: "json" }).$type<string[]>().notNull(),
  modeByMrpId: text("mode_by_mrp_id", { mode: "json" }).$type<Record<string, string>>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  mrpId: text("mrp_id").notNull(),
  type: text("type", { enum: ["image", "file", "code", "link", "diff", "terminal"] }).notNull(),
  name: text("name").notNull(),
  uri: text("uri").notNull(),
  mimeType: text("mime_type"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull()
});

export const mrpSections = sqliteTable("mrp_sections", {
  id: text("id").primaryKey(),
  mrpId: text("mrp_id").notNull(),
  kind: text("kind", {
    enum: [
      "prompt",
      "response",
      "context_sent",
      "thinking",
      "tool_calls",
      "tool_results",
      "files",
      "artifacts",
      "usage",
      "timeline",
      "errors",
      "raw_events"
    ]
  }).notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  sequence: integer("sequence").notNull(),
  collapsedByDefault: integer("collapsed_by_default", { mode: "boolean" }).notNull(),
  selectable: integer("selectable", { mode: "boolean" }).notNull(),
  contextDefault: text("context_default", { enum: ["include", "exclude", "summarize"] }).notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const mrpBlocks = sqliteTable("mrp_blocks", {
  id: text("id").primaryKey(),
  mrpId: text("mrp_id").notNull(),
  sectionId: text("section_id").notNull(),
  kind: text("kind", {
    enum: [
      "text",
      "thinking",
      "tool_call",
      "tool_result",
      "file_reference",
      "artifact",
      "usage",
      "error",
      "event"
    ]
  }).notNull(),
  sequence: integer("sequence").notNull(),
  content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  selectable: integer("selectable", { mode: "boolean" }).notNull(),
  tokenEstimate: integer("token_estimate"),
  sourceEventIds: text("source_event_ids", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const mrpEvents = sqliteTable("mrp_events", {
  id: text("id").primaryKey(),
  mrpId: text("mrp_id").notNull(),
  modelRunId: text("model_run_id"),
  type: text("type").notNull(),
  sequence: integer("sequence").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull()
});

export const modelRuns = sqliteTable("model_runs", {
  id: text("id").primaryKey(),
  canvasId: text("canvas_id").notNull(),
  mrpId: text("mrp_id").notNull(),
  provider: text("provider", {
    enum: ["mock", "llama_cpp", "openai_compatible", "pi_mono", "codex", "ampcode", "squire"]
  }).notNull(),
  model: text("model").notNull(),
  inputMrpIds: text("input_mrp_ids", { mode: "json" }).$type<string[]>().notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  timingMs: integer("timing_ms"),
  finishReason: text("finish_reason"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error")
});
