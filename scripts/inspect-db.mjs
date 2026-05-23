#!/usr/bin/env node
import Database from "better-sqlite3";

const dbPath = process.env.FLOWUX_DB_PATH ?? "apps/api/flowux.db";
const db = new Database(dbPath);
const mrpId = process.argv[2];

if (!mrpId) {
  const rows = db
    .prepare(
      `select id, canvas_id, title, status, created_at, updated_at,
              length(coalesce(assistant_response,'')) as response_len
         from mrps
        order by created_at desc
        limit 12`
    )
    .all();
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const mrp = db.prepare("select * from mrps where id = ?").get(mrpId);
const runs = db.prepare("select * from model_runs where mrp_id = ?").all(mrpId);
const events = db
  .prepare("select type, sequence, created_at, payload from mrp_events where mrp_id = ? order by sequence")
  .all(mrpId)
  .map((event) => ({ ...event, payload: safeJson(event.payload) }));
const sections = db
  .prepare("select id, kind, title, summary, sequence from mrp_sections where mrp_id = ? order by sequence")
  .all(mrpId);
const blocks = db
  .prepare("select section_id, kind, sequence, content from mrp_blocks where mrp_id = ? order by section_id, sequence")
  .all(mrpId)
  .map((block) => ({ ...block, content: safeJson(block.content) }));

console.log(JSON.stringify({ mrp, runs, sections, blocks, events }, null, 2));

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
