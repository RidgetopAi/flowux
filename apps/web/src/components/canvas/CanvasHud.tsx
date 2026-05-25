import { Cpu, Gauge, Square } from "lucide-react";
import { useFlowuxStore } from "../../store.js";
import { Button } from "../primitives/Button";
import { Label } from "../primitives/Label";
import { cn } from "../../lib/cn";
import "./CanvasHud.css";

/**
 * Top-left runtime HUD overlaid on the canvas surface. Mirrors the
 * top-right CanvasControls (zoom / arrange / compose) so canvas chrome
 * is balanced — runtime status on the left, canvas actions on the right.
 *
 * Three chips, rendered in this order when their data exists:
 *   - Exec context  (harness + host label, e.g. "pi_mono · xai/grok-4.3")
 *   - Context budget (token estimate / available + fill bar + warning color)
 *   - Cancel STOP button (only mounted while promptRunning is true)
 */
export function CanvasHud() {
  const exec = useFlowuxStore((s) => s.executionContext);
  const budget = useFlowuxStore((s) => s.contextBudget);
  const running = useFlowuxStore((s) => s.promptRunning);
  const cancelActivePrompt = useFlowuxStore((s) => s.cancelActivePrompt);

  if (!exec && !budget && !running) return null;

  return (
    <div className="canvas-hud" aria-label="Runtime status">
      {exec && (
        <div
          className="canvas-hud__chip"
          title={
            exec.warning
              ? `${exec.harness} · ${exec.hostLabel ?? "—"}\n${exec.warning}`
              : `${exec.harness} · ${exec.hostLabel ?? "—"}`
          }
        >
          <Cpu size={13} className="canvas-hud__icon" aria-hidden="true" />
          <Label size="micro" tone="cyan">
            {exec.harness}
          </Label>
          {exec.hostLabel && (
            <span className="canvas-hud__exec-host">{exec.hostLabel}</span>
          )}
        </div>
      )}

      {(exec && budget) && <div className="canvas-hud__divider" />}

      {budget && (
        <div
          className={cn(
            "canvas-hud__chip",
            "canvas-hud__budget",
            budget.warning && `canvas-hud__budget--${budget.warning}`,
          )}
          title={`${budget.estimatedTokens} of ${budget.availableInputTokens} available · ${budget.percentOfInputBudget.toFixed(1)}% of input budget · ${budget.messageCount} msgs / ${budget.mrpCount} MRPs`}
        >
          <Gauge size={13} className="canvas-hud__icon" aria-hidden="true" />
          <Label size="micro" tone="muted">
            CTX
          </Label>
          <span className="canvas-hud__budget-tok">
            {formatTokens(budget.estimatedTokens)}
          </span>
          <span className="canvas-hud__budget-sep">/</span>
          <span className="canvas-hud__budget-cap">
            {formatTokens(budget.availableInputTokens)}
          </span>
          <div className="canvas-hud__budget-bar" aria-hidden="true">
            <div
              className="canvas-hud__budget-fill"
              style={{ width: `${Math.min(100, Math.max(0, budget.percentOfInputBudget))}%` }}
            />
          </div>
        </div>
      )}

      {running && (
        <>
          {(exec || budget) && <div className="canvas-hud__divider" />}
          <Button
            size="sm"
            variant="danger"
            icon={<Square size={12} />}
            onClick={() => void cancelActivePrompt()}
            title="Cancel active model run"
          >
            STOP
          </Button>
        </>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
