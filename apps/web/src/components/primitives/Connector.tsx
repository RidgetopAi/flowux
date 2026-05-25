import { type CSSProperties, useId } from "react";
import { cn } from "../../lib/cn";
import "./Connector.css";

type Tone = "cyan" | "violet" | "amber";
type Curve = "straight" | "bezier";

type Props = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  tone?: Tone;
  curve?: Curve;
  /** Animated dash march. */
  animate?: boolean;
  /** When false, render a solid line instead of the dashed pattern.
   *  Default true preserves prior behavior. */
  dashed?: boolean;
  /** Stroke width in px. */
  width?: number;
  className?: string;
  style?: CSSProperties;
};

const TONE_STROKE: Record<Tone, string> = {
  cyan: "rgba(168, 255, 241, 0.55)",
  violet: "rgba(199, 189, 255, 0.55)",
  amber: "rgba(244, 208, 117, 0.55)",
};

const TONE_GLOW: Record<Tone, string> = {
  cyan: "rgba(168, 255, 241, 0.6)",
  violet: "rgba(199, 189, 255, 0.6)",
  amber: "rgba(244, 208, 117, 0.6)",
};

/**
 * SVG connector line between two screen-space points. Used for inter-card
 * relationships (context flows, branching, references). Dashed by default,
 * with optional dash-march animation.
 *
 * Computes its own bounding box from from/to so the SVG only covers the
 * line's region — keeps the DOM tidy.
 */
export function Connector({
  from,
  to,
  tone = "cyan",
  curve = "bezier",
  animate = true,
  dashed = true,
  width = 1.4,
  className,
  style,
}: Props) {
  const glowId = useId().replace(/:/g, "");

  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const w = Math.max(2, Math.abs(to.x - from.x));
  const h = Math.max(2, Math.abs(to.y - from.y));
  const pad = 16;

  // Local coords inside the SVG
  const x1 = from.x - minX + pad;
  const y1 = from.y - minY + pad;
  const x2 = to.x - minX + pad;
  const y2 = to.y - minY + pad;

  // Bezier control points — horizontal-ease for a calmer arc
  const cx = (x1 + x2) / 2;
  const c1x = curve === "bezier" ? cx : x1;
  const c1y = curve === "bezier" ? y1 : y1;
  const c2x = curve === "bezier" ? cx : x2;
  const c2y = curve === "bezier" ? y2 : y2;

  const path =
    curve === "bezier"
      ? `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`
      : `M ${x1} ${y1} L ${x2} ${y2}`;

  return (
    <svg
      className={cn("connector", animate && "connector--animate", className)}
      style={{
        position: "absolute",
        left: minX - pad,
        top: minY - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        pointerEvents: "none",
        overflow: "visible",
        ...style,
      }}
      aria-hidden="true"
    >
      <defs>
        <filter id={`glow-${glowId}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d={path}
        fill="none"
        stroke={TONE_GLOW[tone]}
        strokeWidth={width + 1.5}
        strokeLinecap="round"
        opacity="0.35"
        filter={`url(#glow-${glowId})`}
      />
      <path
        d={path}
        fill="none"
        stroke={TONE_STROKE[tone]}
        strokeWidth={width}
        strokeDasharray={dashed ? "6 8" : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}
