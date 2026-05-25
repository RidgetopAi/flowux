import { type ReactNode, type HTMLAttributes } from "react";
import "./ChromaText.css";

type Props = {
  children: string;
  /** Continuous shimmer animation. */
  shimmer?: boolean;
  /** Force the active (hover-like) chroma split open. */
  active?: boolean;
  /** Render as block instead of inline-block. */
  block?: boolean;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
} & Omit<HTMLAttributes<HTMLElement>, "children">;

/**
 * Holographic chroma-split text. Renders three layers:
 *   - red channel offset left
 *   - blue channel offset right
 *   - clean ink on top
 *
 * The text MUST be a plain string — the effect uses `data-text` attribute
 * to render the chroma layers via ::before / ::after pseudo-elements.
 */
export function ChromaText({
  children,
  shimmer = false,
  active = false,
  block = false,
  as: Tag = "span",
  className,
  style,
  ...rest
}: Props): ReactNode {
  const classes = [
    "fx-chroma-text",
    "chroma-text",
    shimmer && "fx-shimmer",
    block && "chroma-text--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag
      {...rest}
      aria-label={children}
      data-text={children}
      data-active={active ? "true" : undefined}
      className={classes}
      style={style}
    >
      <span aria-hidden="true">{children}</span>
    </Tag>
  );
}
