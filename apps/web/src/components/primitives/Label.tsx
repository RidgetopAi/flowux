import { type ReactNode, type CSSProperties } from "react";
import { cn } from "../../lib/cn";
import "./Label.css";

type Size = "micro" | "label";
type Tone = "muted" | "ink" | "soft" | "cyan" | "violet" | "amber";

type Props = {
  children: ReactNode;
  size?: Size;
  tone?: Tone;
  /** Adds a thin Braille-band underline beneath the label. */
  underline?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function Label({
  children,
  size = "label",
  tone = "muted",
  underline = false,
  className,
  style,
}: Props) {
  return (
    <span
      className={cn(
        "label",
        size === "micro" ? "fx-mono-micro" : "fx-mono-label",
        `label--${tone}`,
        underline && "label--underline",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
