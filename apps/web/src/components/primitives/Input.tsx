import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import "./Field.css";

type Props = {
  label?: string;
  hint?: string;
  error?: string;
  /** Render the label as uppercase mono micro-label (default true). */
  microLabel?: boolean;
  /** Optional leading icon. */
  icon?: React.ReactNode;
} & InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, microLabel = true, icon, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className={cn("field", error && "field--error")}>
      {label && (
        <label
          htmlFor={inputId}
          className={cn("field__label", microLabel && "fx-mono-label")}
        >
          {label}
        </label>
      )}
      <div className={cn("field__shell", !!icon && "field__shell--has-icon")}>
        {icon && <span className="field__icon">{icon}</span>}
        <input ref={ref} id={inputId} className={cn("field__input", className)} {...rest} />
      </div>
      {(hint || error) && (
        <div
          className={cn("field__sub", "fx-mono-micro", error && "field__sub--error")}
        >
          {error ?? hint}
        </div>
      )}
    </div>
  );
});
