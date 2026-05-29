import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCanvas } from "../lib/store";
import { BrailleBand } from "../components/effects/BrailleBand";
import { HudBar } from "./components/HudBar";
import { Playfield } from "./components/Playfield";
import { StatusStrip } from "./components/StatusStrip";
import { Game, type HudSnapshot } from "./components/Game";
import "./Invaders.css";

/* ── Invaders overlay ──────────────────────────────────────────────────
 * Top-level layer for the Space Invaders side-feature. Mounts above the
 * canvas, fixed-position so it covers the full viewport. Owns the
 * projection surface (backdrop, beam, scanlines, vignette, frame, bands)
 * and composes the in-frame HUD + game + status strip.
 *
 * HUD state is lifted here so <HudBar /> can be driven by the engine's
 * loop callback. <Game /> owns the simulation; this component is pure
 * UI composition + window-level Esc handling.
 */
export function InvadersOverlay() {
  const open = useCanvas((s) => s.invadersOpen);
  return <AnimatePresence>{open && <InvadersStage />}</AnimatePresence>;
}

function InvadersStage() {
  const close = useCanvas((s) => s.closeInvaders);

  // HUD-projected slice of game state. The Game component pushes
  // updates via onHud — we only re-render the HUD on actual change,
  // not on every frame.
  const [hud, setHud] = useState<HudSnapshot>({
    score: 0,
    hiScore: 0,
    wave: 1,
    lives: 3,
    phase: "attract",
  });

  // Stable callback identity so the Game effect doesn't re-spin its
  // canvas/loop every render.
  const onHud = useCallback((next: HudSnapshot) => setHud(next), []);

  // Window-level Esc handler. The game owns input while open — capture
  // phase so we beat Canvas's own keydown listener to the punch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [close]);

  return (
    <motion.div
      className="invaders-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      role="dialog"
      aria-label="Space Invaders"
    >
      <div className="invaders-overlay__backdrop" aria-hidden="true" />
      <div className="invaders-overlay__beam" aria-hidden="true" />
      <div className="invaders-overlay__scanlines" aria-hidden="true" />

      <motion.div
        className="invaders-overlay__frame"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
      >
        <BrailleBand
          className="invaders-overlay__band invaders-overlay__band--top"
          length={120}
          density={0.42}
          tone="cyan"
          seed={11}
        />

        <HudBar
          score={hud.score}
          hiScore={hud.hiScore}
          wave={hud.wave}
          lives={hud.lives}
        />

        <Playfield>
          <Game onHud={onHud} />
        </Playfield>

        <StatusStrip phaseLabel={statusLabel(hud.phase)} />

        <BrailleBand
          className="invaders-overlay__band invaders-overlay__band--bottom"
          length={120}
          density={0.42}
          tone="cyan"
          seed={29}
        />
      </motion.div>

      <div className="invaders-overlay__vignette" aria-hidden="true" />
    </motion.div>
  );
}

function statusLabel(phase: HudSnapshot["phase"]): string {
  switch (phase) {
    case "attract":
      return "PHASE 3 · ATTRACT";
    case "playing":
      return "PHASE 3 · WAVE IN PROGRESS";
    case "gameOver":
      return "PHASE 3 · GAME OVER";
  }
}
