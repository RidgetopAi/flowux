import { type ReactNode, type CSSProperties } from "react";

type Tone = "cyan" | "violet" | "amber";

type Props = {
  children: ReactNode;
  tone?: Tone;
  /** Force the bloom on (e.g. for selected / active surfaces). */
  active?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Wraps content with a soft outer bloom that wakes on hover.
 * Used on primary actions and selected surfaces.
 */
export function Halation({
  children,
  tone = "cyan",
  active = false,
  className,
  style,
}: Props) {
  const toneClass = tone === "cyan" ? "" : `fx-halation-${tone}`;
  return (
    <div
      className={["fx-halation", toneClass, className].filter(Boolean).join(" ")}
      data-active={active ? "true" : undefined}
      style={style}
    >
      {children}
    </div>
  );
}
