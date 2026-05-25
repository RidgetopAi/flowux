import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import "./Field.css";

type Props = {
  label?: string;
  hint?: string;
  error?: string;
  microLabel?: boolean;
  /** Auto-grow as user types. */
  autosize?: boolean;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  { label, hint, error, microLabel = true, autosize = false, id, className, onInput, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <div className={cn("field", error && "field--error")}>
      {label && (
        <label
          htmlFor={fieldId}
          className={cn("field__label", microLabel && "fx-mono-label")}
        >
          {label}
        </label>
      )}
      <div className="field__shell field__shell--textarea">
        <textarea
          ref={ref}
          id={fieldId}
          className={cn(
            "field__input",
            "field__input--textarea",
            autosize && "field__input--autosize",
            className,
          )}
          onInput={(e) => {
            if (autosize) {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }
            onInput?.(e);
          }}
          {...rest}
        />
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
