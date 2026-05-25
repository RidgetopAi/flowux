import { cn } from "../../lib/cn";
import "./StatusDot.css";

type Status = "idle" | "pending" | "active" | "complete" | "error";
type Size = "sm" | "md" | "lg";

type Props = {
  status: Status;
  size?: Size;
  /** Pulse animation on idle/pending/active. */
  pulse?: boolean;
  label?: string;
  className?: string;
};

export function StatusDot({
  status,
  size = "md",
  pulse = true,
  label,
  className,
}: Props) {
  const shouldPulse = pulse && (status === "pending" || status === "active");

  return (
    <span
      className={cn(
        "status-dot-wrap",
        `status-dot-wrap--${size}`,
        className,
      )}
      role="status"
      aria-label={label ?? status}
    >
      <span
        className={cn(
          "status-dot",
          `status-dot--${status}`,
          shouldPulse && "status-dot--pulse",
        )}
      />
      {label && <span className="status-dot__label fx-mono-micro">{label}</span>}
    </span>
  );
}
