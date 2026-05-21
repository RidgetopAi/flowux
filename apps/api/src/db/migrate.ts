import { sqlite } from "./client.js";

const statements = [
  `CREATE TABLE IF NOT EXISTS canvas_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    parent_canvas_id TEXT,
    parent_branch_id TEXT,
    summary TEXT,
    model_config_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS mrps (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    user_prompt TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    model_run_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS canvas_placements (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    mrp_id TEXT NOT NULL,
    origin_canvas_id TEXT,
    is_external_reference INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    collapsed INTEGER NOT NULL,
    selected_for_context INTEGER NOT NULL,
    connection_hidden INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    parent_canvas_id TEXT NOT NULL,
    child_canvas_id TEXT NOT NULL,
    source_mrp_ids TEXT NOT NULL,
    created_at TEXT NOT NULL,
    label TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS context_bundles (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    name TEXT,
    selected_mrp_ids TEXT NOT NULL,
    mode_by_mrp_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    mrp_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT NOT NULL,
    mime_type TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mrp_sections (
    id TEXT PRIMARY KEY,
    mrp_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    sequence INTEGER NOT NULL,
    collapsed_by_default INTEGER NOT NULL,
    selectable INTEGER NOT NULL,
    context_default TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mrp_blocks (
    id TEXT PRIMARY KEY,
    mrp_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    content TEXT NOT NULL,
    selectable INTEGER NOT NULL,
    token_estimate INTEGER,
    source_event_ids TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mrp_events (
    id TEXT PRIMARY KEY,
    mrp_id TEXT NOT NULL,
    model_run_id TEXT,
    type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS model_runs (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    mrp_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_mrp_ids TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    timing_ms INTEGER,
    finish_reason TEXT,
    metadata TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error TEXT
  )`
];

for (const statement of statements) {
  sqlite.exec(statement);
}

const modelRunColumns = sqlite.prepare("PRAGMA table_info(model_runs)").all() as Array<{ name: string }>;
const hasModelRunColumn = (name: string) => modelRunColumns.some((column) => column.name === name);

if (!hasModelRunColumn("total_tokens")) sqlite.exec("ALTER TABLE model_runs ADD COLUMN total_tokens INTEGER");
if (!hasModelRunColumn("timing_ms")) sqlite.exec("ALTER TABLE model_runs ADD COLUMN timing_ms INTEGER");
if (!hasModelRunColumn("finish_reason")) sqlite.exec("ALTER TABLE model_runs ADD COLUMN finish_reason TEXT");
if (!hasModelRunColumn("metadata")) sqlite.exec("ALTER TABLE model_runs ADD COLUMN metadata TEXT");

console.log("Flowux database is ready.");
