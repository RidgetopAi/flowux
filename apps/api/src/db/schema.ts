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
  modelConfigId: text("model_config_id")
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
  modelRunId: text("model_run_id")
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

export const modelRuns = sqliteTable("model_runs", {
  id: text("id").primaryKey(),
  canvasId: text("canvas_id").notNull(),
  mrpId: text("mrp_id").notNull(),
  provider: text("provider", { enum: ["mock", "llama_cpp", "openai_compatible"] }).notNull(),
  model: text("model").notNull(),
  inputMrpIds: text("input_mrp_ids", { mode: "json" }).$type<string[]>().notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error")
});

