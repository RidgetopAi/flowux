import { type ReactNode, type CSSProperties, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import "./Card.css";

type State = "idle" | "active" | "checked" | "focused" | "external";

type CardProps = {
  children: ReactNode;
  state?: State;
  /** Render with grab cursor, drag-ready visual. */
  draggable?: boolean;
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Card({
  children,
  state = "idle",
  draggable = false,
  className,
  style,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      data-state={state}
      className={cn(
        "card",
        `card--${state}`,
        draggable && "card--draggable",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/* ── Sub-components: header / drag-bar / body / footer ───────────────── */

type SlotProps = {
  children: ReactNode;
  className?: string;
};

Card.DragBar = function DragBar({ children, className }: SlotProps) {
  return (
    <div className={cn("card__drag", "fx-mono-micro", className)}>
      {children}
    </div>
  );
};

Card.Header = function Header({ children, className }: SlotProps) {
  return <header className={cn("card__head", className)}>{children}</header>;
};

Card.Title = function Title({ children, className }: SlotProps) {
  return <h2 className={cn("card__title", className)}>{children}</h2>;
};

Card.Meta = function Meta({ children, className }: SlotProps) {
  return <div className={cn("card__meta", className)}>{children}</div>;
};

Card.Body = function Body({ children, className }: SlotProps) {
  return <div className={cn("card__body", className)}>{children}</div>;
};

Card.Section = function Section({ children, className }: SlotProps) {
  return <section className={cn("card__section", className)}>{children}</section>;
};

Card.Footer = function Footer({ children, className }: SlotProps) {
  return (
    <footer className={cn("card__footer", "fx-mono-micro", className)}>
      {children}
    </footer>
  );
};
