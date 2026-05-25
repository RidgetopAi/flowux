import {
  Brain,
  Check,
  CircleAlert,
  Code2,
  FileSearch,
  Loader,
  Pencil,
  PlayCircle,
  Search,
  Wrench,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useCanvas, type ToolCallObject, type ToolCallStatus } from "../../lib/store";
import { cn } from "../../lib/cn";
import "./ToolCallChip.css";

type Props = { tool: ToolCallObject };

/**
 * Derived canvas node — one chip per unique tool_call.id within an MRP's
 * event stream. Not draggable, not in the bundle: it's a visualization
 * of work happening inside the issuing MRP. Click pans + expands the
 * parent MRP so the user can see the full tool result.
 */
export function ToolCallChip({ tool }: Props) {
  const setExpanded = useCanvas((s) => s.setExpanded);
  const revealMRP = useCanvas((s) => s.revealMRP);

  const isOverflow = tool.id.endsWith("-overflow");
  const Icon = isOverflow ? Wrench : iconForName(tool.name);

  const onClick = () => {
    setExpanded(tool.anchoredToId);
    revealMRP(tool.anchoredToId);
  };

  return (
    <button
      type="button"
      data-canvas-card
      data-object-id={tool.id}
      onClick={onClick}
      className={cn(
        "tool-chip",
        `tool-chip--${tool.status}`,
        isOverflow && "tool-chip--overflow",
      )}
      style={{
        position: "absolute",
        left: tool.x,
        top: tool.y,
        width: tool.width,
        height: tool.height,
      }}
      title={
        isOverflow
          ? "Open MRP to see all tool calls"
          : `${tool.name}${tool.argsSummary ? ` · ${tool.argsSummary}` : ""}`
      }
    >
      <Icon size={12} className="tool-chip__icon" aria-hidden="true" />
      <span className="tool-chip__name">{tool.name}</span>
      {!isOverflow && tool.argsSummary && (
        <span className="tool-chip__args">{tool.argsSummary}</span>
      )}
      {!isOverflow && <StatusGlyph status={tool.status} />}
    </button>
  );
}

function StatusGlyph({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case "complete":
      return <Check size={10} className="tool-chip__status tool-chip__status--ok" aria-hidden="true" />;
    case "error":
      return <CircleAlert size={10} className="tool-chip__status tool-chip__status--err" aria-hidden="true" />;
    case "streaming":
    case "started":
      return <Loader size={10} className="tool-chip__status tool-chip__status--run" aria-hidden="true" />;
  }
}

/** Per-name icon mapping. Falls back to a generic Wrench when the tool
 *  name isn't recognized — keeps the surface readable even for new tools
 *  that haven't been mapped yet. */
function iconForName(name: string): ComponentType<SVGProps<SVGSVGElement> & { size?: number }> {
  const n = name.toLowerCase();
  if (n === "read" || n === "open") return FileSearch;
  if (n === "bash" || n === "shell" || n === "run") return PlayCircle;
  if (n === "edit" || n === "write") return Pencil;
  if (n === "grep" || n === "search" || n === "find") return Search;
  if (n.startsWith("mandrel_") || n === "smart_search") return Brain;
  if (n === "code" || n === "compile") return Code2;
  return Wrench;
}
