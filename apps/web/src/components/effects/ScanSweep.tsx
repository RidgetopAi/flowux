import { type ReactNode, type CSSProperties } from "react";

type Props = {
  children: ReactNode;
  /** Sweep cycle duration. */
  duration?: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * Wraps content with a slow vertical light pass. Used on dormant surfaces
 * (idle panels, status displays) to add liveness without distraction.
 */
export function ScanSweep({ children, duration = 6, className, style }: Props) {
  const composedStyle: CSSProperties = {
    ...style,
    ["--sweep-duration" as string]: `${duration}s`,
  };
  return (
    <div
      className={["fx-scan-sweep", className].filter(Boolean).join(" ")}
      style={composedStyle}
    >
      {children}
    </div>
  );
}
