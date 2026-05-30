import { Activity } from "lucide-react";
import { useCanvas } from "../../lib/store";
import { useToolStream } from "../../lib/toolStream";
import "./TelemetryLamp.css";

/**
 * Twin of the ComposeLight, pinned directly below it. Toggles the tool
 * telemetry panel. When tool calls are actively streaming but the panel is
 * closed, the lamp pulses amber ("there's live activity in here").
 */
export function TelemetryLamp() {
  const open = useCanvas((s) => s.telemetryOpen);
  const toggle = useCanvas((s) => s.toggleTelemetry);
  const items = useToolStream();
  const live = items.some((t) => t.status === "started" || t.status === "streaming");

  return (
    <button
      type="button"
      className="tl-lamp"
      data-active={open ? "true" : undefined}
      data-live={live ? "true" : undefined}
      onClick={toggle}
      aria-label="Tool telemetry stream"
      aria-pressed={open}
      title="Tool telemetry stream"
    >
      <span className="tl-lamp__glow" aria-hidden="true" />
      <Activity />
    </button>
  );
}
