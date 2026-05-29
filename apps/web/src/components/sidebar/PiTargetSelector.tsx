import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Loader2, Plug, Server } from "lucide-react";
import { useFlowuxStore } from "../../store.js";
import { cn } from "../../lib/cn";
import { Label } from "../primitives/Label";
import "./PiTargetSelector.css";

/**
 * Top-bar control to pick which Pi the API spawns prompts against — a global
 * active target (local grok / remote desktop). The trigger shows the active
 * target + a reachable dot; the popover lists targets (click to switch) and a
 * Connect button that runs a live connectivity test.
 */
export function PiTargetSelector() {
  const targets = useFlowuxStore((s) => s.piTargets);
  const activeTargetId = useFlowuxStore((s) => s.activeTargetId);
  const piPing = useFlowuxStore((s) => s.piPing);
  const piTesting = useFlowuxStore((s) => s.piTesting);
  const switchPiTarget = useFlowuxStore((s) => s.switchPiTarget);
  const testPiTarget = useFlowuxStore((s) => s.testPiTarget);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to show when the API isn't running Pi (no targets registered).
  if (targets.length === 0) return null;

  const active = targets.find((t) => t.id === activeTargetId) ?? targets[0];
  const activePing = active ? piPing[active.id] : undefined;
  const activeStatus = statusOf(active?.id, piPing, piTesting);

  return (
    <div className="pi-target" ref={rootRef}>
      <button
        type="button"
        className={cn("pi-target__trigger", open && "pi-target__trigger--open")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Pi target — where prompts run"
      >
        <span className={cn("pi-target__dot", `pi-target__dot--${activeStatus}`)} aria-hidden="true" />
        {active?.transport === "ssh" ? <Server size={13} /> : <Cpu size={13} />}
        <span className="pi-target__label">{active?.label ?? "Pi target"}</span>
        <ChevronDown size={13} className="pi-target__chev" aria-hidden="true" />
      </button>

      {open && (
        <div className="pi-target__pop" role="listbox" aria-label="Pi targets">
          <div className="pi-target__pop-head">
            <Label size="micro" tone="cyan">PI TARGET</Label>
            <Label size="micro" tone="muted">where prompts run</Label>
          </div>

          <div className="pi-target__list">
            {targets.map((t) => {
              const isActive = t.id === active?.id;
              const status = statusOf(t.id, piPing, piTesting);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={cn("pi-target__row", isActive && "pi-target__row--active")}
                  onClick={() => void switchPiTarget(t.id)}
                >
                  <span className={cn("pi-target__dot", `pi-target__dot--${status}`)} aria-hidden="true" />
                  {t.transport === "ssh" ? <Server size={13} /> : <Cpu size={13} />}
                  <span className="pi-target__row-main">
                    <span className="pi-target__row-label">{t.label}</span>
                    <span className="pi-target__row-sub">
                      {t.provider}/{t.model}
                      {t.transport === "ssh" && t.sshHost ? ` · ssh ${t.sshHost}` : " · local"}
                    </span>
                  </span>
                  {isActive && <Check size={13} className="pi-target__row-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="pi-target__foot">
            <button
              type="button"
              className="pi-target__connect"
              onClick={() => active && void testPiTarget(active.id)}
              disabled={!active || piTesting === active?.id}
            >
              {piTesting === active?.id ? (
                <Loader2 size={13} className="pi-target__spin" aria-hidden="true" />
              ) : (
                <Plug size={13} aria-hidden="true" />
              )}
              {piTesting === active?.id ? "Connecting…" : "Connect"}
            </button>
            <span className={cn("pi-target__result", activePing && (activePing.ok ? "pi-target__result--ok" : "pi-target__result--err"))}>
              {piTesting === active?.id
                ? "testing…"
                : activePing
                  ? activePing.ok
                    ? `reachable · ${activePing.latencyMs}ms`
                    : activePing.error ?? "not reachable"
                  : "not tested"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

type DotStatus = "idle" | "testing" | "ok" | "err";

function statusOf(
  id: string | undefined,
  piPing: Record<string, { ok: boolean }>,
  piTesting: string | undefined
): DotStatus {
  if (!id) return "idle";
  if (piTesting === id) return "testing";
  const ping = piPing[id];
  if (!ping) return "idle";
  return ping.ok ? "ok" : "err";
}
