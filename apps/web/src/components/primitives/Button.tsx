import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import "./Button.css";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = {
  variant?: Variant;
  size?: Size;
  /** Leading icon (left side). Pass a lucide-react icon element. */
  icon?: ReactNode;
  /** Render as a square icon-only button. */
  iconOnly?: boolean;
  /** Show a spinner instead of content, disable interaction. */
  loading?: boolean;
  /** Add halation bloom on hover (already implied for primary variant). */
  bloom?: boolean;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "default",
    size = "md",
    icon,
    iconOnly = false,
    loading = false,
    bloom = false,
    children,
    className,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const shouldBloom = bloom || variant === "primary";
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-loading={loading ? "true" : undefined}
      className={cn(
        "btn",
        `btn--${variant}`,
        `btn--${size}`,
        iconOnly && "btn--icon-only",
        shouldBloom && "fx-halation",
        variant === "primary" && "btn--has-bloom",
        className,
      )}
      {...rest}
    >
      <span className="btn__inner">
        {loading ? (
          <Loader2 className="btn__spinner" aria-hidden />
        ) : iconOnly ? (
          // Icon-only: prefer the explicit `icon` prop, otherwise treat
          // children as the icon. Every iconOnly caller in the codebase
          // passes the lucide icon as children — keep that ergonomic.
          <span className="btn__icon">{icon ?? children}</span>
        ) : (
          <>
            {icon && <span className="btn__icon">{icon}</span>}
            {children && <span className="btn__label">{children}</span>}
          </>
        )}
      </span>
    </button>
  );
});
