#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/flowux-env.sh"
flowux_cd_root

echo "== API health =="
if ! curl -sS --max-time 5 "$FLOWUX_API_URL/api/health"; then
  echo
  echo "API health failed at $FLOWUX_API_URL"
fi
echo

echo "== Flowux processes =="
ps -ef | grep -E 'apps/api/src/server|vite --host|ssh ridgetop@ridgetop-desktop cd|pi-mono/packages/coding-agent' | grep -v grep || true

echo
echo "== Streaming MRPs =="
node --input-type=module <<'NODE'
import Database from "better-sqlite3";

const db = new Database(process.env.FLOWUX_DB_PATH ?? "apps/api/flowux.db");
const rows = db
  .prepare(
    `select id, canvas_id, title, status, created_at, updated_at
       from mrps
      where status = 'streaming'
      order by created_at desc
      limit 10`
  )
  .all();
console.log(rows.length ? JSON.stringify(rows, null, 2) : "none");
NODE

echo
echo "== Latest MRPs =="
node --input-type=module <<'NODE'
import Database from "better-sqlite3";

const db = new Database(process.env.FLOWUX_DB_PATH ?? "apps/api/flowux.db");
const rows = db
  .prepare(
    `select id, canvas_id, title, status, created_at, length(coalesce(assistant_response,'')) as response_len
       from mrps
      order by created_at desc
      limit 6`
  )
  .all();
console.log(JSON.stringify(rows, null, 2));
NODE

if [ -f "$FLOWUX_API_LOG" ] && grep -q "Server listening" "$FLOWUX_API_LOG"; then
  echo
  echo "== API log tail: $FLOWUX_API_LOG =="
  tail -80 "$FLOWUX_API_LOG"
elif [ -f /tmp/flowux-api-restart.log ]; then
  echo
  echo "== API log tail: /tmp/flowux-api-restart.log =="
  tail -80 /tmp/flowux-api-restart.log
fi
