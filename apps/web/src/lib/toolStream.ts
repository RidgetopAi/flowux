import { useMemo } from "react";
import type { CanvasSnapshot, MrpEvent } from "@flowux/shared";
import { useFlowuxStore } from "../store.js";

export type ToolStreamStatus = "started" | "streaming" | "complete" | "error";

/** One folded tool call for the telemetry panel — all events sharing a
 *  toolCall.id collapse into a single item, with its result text joined on. */
export interface ToolStreamItem {
  id: string;
  mrpId: string;
  mrpSequence: number;
  name: string;
  argsSummary?: string;
  status: ToolStreamStatus;
  result?: string;
  isError?: boolean;
  /** Stable first-seen order so the panel renders chronologically. */
  order: number;
}

const RANK: Record<ToolStreamStatus, number> = { started: 0, streaming: 1, complete: 2, error: 3 };

/**
 * Build the ordered tool stream from a snapshot's persisted events merged with
 * the in-flight live SSE buffer. snapshot.events come first (historical), live
 * events append after (they belong to the newest, in-progress MRP). Folds
 * tool_call_* by toolCall.id and joins tool_result_* by toolCallId.
 */
export function buildToolStream(
  snapshot: CanvasSnapshot | undefined,
  liveEvents: MrpEvent[]
): ToolStreamItem[] {
  if (!snapshot) return [];
  const seqByMrp = new Map(snapshot.mrps.map((m) => [m.id, m.sequence]));
  const events = [...(snapshot.events ?? []), ...liveEvents];

  const byId = new Map<string, ToolStreamItem>();
  const resultsByCallId = new Map<string, { text: string; isError?: boolean }>();
  let order = 0;

  for (const ev of events) {
    if (ev.type.startsWith("tool_call_")) {
      const tc = (ev.payload as { toolCall?: { id?: string; name?: string; args?: unknown; status?: string } }).toolCall;
      if (!tc?.id || tc.id === "tool-unknown") continue; // Pi emits placeholder ids we ignore
      const candidate = mapStatus(ev.type, tc.status);
      const existing = byId.get(tc.id);
      if (existing) {
        if (RANK[candidate] >= RANK[existing.status]) existing.status = candidate;
      } else {
        byId.set(tc.id, {
          id: tc.id,
          mrpId: ev.mrpId,
          mrpSequence: seqByMrp.get(ev.mrpId) ?? 0,
          name: tc.name ?? "tool",
          argsSummary: formatArgs(tc.args),
          status: candidate,
          order: order++
        });
      }
    } else if (ev.type.startsWith("tool_result_")) {
      const tr = (ev.payload as { toolResult?: { toolCallId?: string; result?: unknown; isError?: boolean } }).toolResult;
      if (!tr?.toolCallId) continue;
      const prev = resultsByCallId.get(tr.toolCallId) ?? { text: "" };
      const chunk = resultText(tr.result);
      // completed carries the full result when present; deltas accumulate.
      prev.text = ev.type === "tool_result_completed" ? chunk || prev.text : prev.text + chunk;
      if (tr.isError) prev.isError = true;
      resultsByCallId.set(tr.toolCallId, prev);
    }
  }

  for (const [callId, r] of resultsByCallId) {
    const item = byId.get(callId);
    if (!item) continue;
    item.result = r.text || undefined;
    if (r.isError) {
      item.isError = true;
      if (item.status === "complete") item.status = "error";
    }
  }

  return [...byId.values()].sort((a, b) => a.order - b.order);
}

function mapStatus(evType: string, rawStatus: string | undefined): ToolStreamStatus {
  if (evType === "tool_call_completed") return rawStatus === "error" ? "error" : "complete";
  if (evType === "tool_call_delta") return "streaming";
  return "started";
}

/** One-line k=v summary of a tool's args, trimmed so a row stays compact. */
function formatArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      let val: string;
      if (typeof v === "string") val = `"${v.length > 32 ? v.slice(0, 32) + "…" : v}"`;
      else if (typeof v === "number" || typeof v === "boolean") val = String(v);
      else val = "{…}";
      return `${k}=${val}`;
    })
    .join(" ");
}

function resultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

/** React hook — the live, memoized tool stream for the current canvas. */
export function useToolStream(): ToolStreamItem[] {
  const snapshot = useFlowuxStore((s) => s.snapshot);
  const live = useFlowuxStore((s) => s.liveToolEvents);
  return useMemo(() => buildToolStream(snapshot, live), [snapshot, live]);
}
