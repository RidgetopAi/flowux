import type { CanvasObject } from "../../lib/store";
import { MRPCard } from "./MRPCard";
import { ImageCard } from "./ImageCard";
import { ToolCallChip } from "./ToolCallChip";

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
      return <ToolCallChip tool={object} />;
    default:
      // Exhaustiveness guard — if a new variant gets added to CanvasObject
      // without a case here, TypeScript will complain at compile time.
      return null;
  }
}
