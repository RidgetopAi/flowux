import { type ReactNode, type CSSProperties, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import "./Panel.css";

type Variant = "panel" | "shell" | "flat";
type Tone = "neutral" | "warm" | "cool";

type Props = {
  children: ReactNode;
  variant?: Variant;
  tone?: Tone;
  /** Adds the slow scan-sweep overlay. */
  sweep?: boolean;
  /** Adds the subtle CRT grain. */
  grain?: boolean;
  /** Adds the Braille dot-noise background texture. */
  noise?: boolean;
  /** Override internal padding. */
  pad?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

/**
 * Glass surface. Three variants:
 *   - `shell`: large outer container (hud-shell). Radius xl, deep shadow.
 *   - `panel`: standard inner panel. Radius lg, regular shadow.
 *   - `flat`: no shadow, no gradient — for embedded surfaces.
 */
export function Panel({
  children,
  variant = "panel",
  tone = "neutral",
  sweep = false,
  grain = false,
  noise = false,
  pad,
  className,
  style,
  ...rest
}: Props) {
  const composedStyle: CSSProperties = pad ? { ...style, padding: pad } : style ?? {};
  return (
    <div
      {...rest}
      className={cn(
        "panel",
        `panel--${variant}`,
        `panel--tone-${tone}`,
        sweep && "fx-scan-sweep",
        grain && "fx-crt-grain",
        noise && "panel--noise",
        className,
      )}
      style={composedStyle}
    >
      {children}
    </div>
  );
}
