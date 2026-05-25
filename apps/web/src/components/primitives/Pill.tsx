import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import "./Pill.css";

type Tone = "neutral" | "cyan" | "violet" | "amber" | "green" | "red";

type Props = {
  children: ReactNode;
  tone?: Tone;
  /** Slightly larger padding + brighter text. */
  emphasis?: boolean;
  className?: string;
};

export function Pill({ children, tone = "neutral", emphasis = false, className }: Props) {
  return (
    <span
      className={cn(
        "pill",
        `pill--${tone}`,
        emphasis && "pill--emphasis",
        "fx-mono-micro",
        className,
      )}
    >
      {children}
    </span>
  );
}
