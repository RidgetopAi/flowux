import type { CanvasObject } from "../../lib/store";
import { MRPCard } from "./MRPCard";
import { ImageCard } from "./ImageCard";

/**
 * Dispatcher for canvas objects. Switches on the discriminated union's
 * `type` field and renders the variant-specific node component. Adding
 * a new variant = add a type to CanvasObject + write its renderer + add
 * a case here.
 */
type Props = { object: CanvasObject };

export function ObjectNode({ object }: Props) {
  switch (object.type) {
    case "mrp":
      return <MRPCard mrp={object} />;
    case "image":
      return <ImageCard image={object} />;
    case "tool_call":
      // Tool calls are no longer canvas nodes — they stream into the telemetry
      // panel (TelemetryPanel.tsx). canvasAdapter no longer emits these.
      return null;
    case "state":
      // STATE snapshots are no longer canvas tiles — they're opened from the
      // COMPACTED chip on an MRP via the stateSnapshots lookup. Should never
      // reach here (none are emitted into `objects`), but keep the union
      // exhaustive so TypeScript still flags genuinely-unhandled variants.
      return null;
    default:
      // Exhaustiveness guard — if a new variant gets added to CanvasObject
      // without a case here, TypeScript will complain at compile time.
      return null;
  }
}
