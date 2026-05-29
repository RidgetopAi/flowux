import { MessageSquarePlus } from "lucide-react";
import { useCanvas } from "../../lib/store";
import "./ComposeLight.css";

/**
 * Standalone compose / new-message light. Lives on its own in the top-right
 * of the canvas — deliberately NOT inside the utility toolbar — so it reads
 * as the primary action. Two states:
 *   OFF (dock closed) → dim cyan-deep standby glow, faint bloom
 *   ON  (dock open)   → bright cyan-bright core + full bloom that spills onto
 *                       the canvas behind it, slow breathe
 * Clicking toggles the compose dock open/closed.
 */
export function ComposeLight() {
  const dockOpen = useCanvas((s) => s.dockOpen);
  const openDock = useCanvas((s) => s.openDock);
  const closeDock = useCanvas((s) => s.closeDock);

  return (
    <button
      type="button"
      className="compose-light"
      data-active={dockOpen ? "true" : undefined}
      onClick={dockOpen ? closeDock : openDock}
      aria-label="Compose new message (/)"
      aria-pressed={dockOpen}
      title="Compose new message (/)"
    >
      <span className="compose-light__glow" aria-hidden="true" />
      <MessageSquarePlus />
    </button>
  );
}
