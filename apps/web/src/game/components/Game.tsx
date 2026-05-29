import { useEffect, useRef, useState } from "react";
import { PLAYFIELD_H, PLAYFIELD_W } from "../engine/constants";
import { createInputHandler } from "../engine/input";
import { startLoop } from "../engine/loop";
import { createInitialState } from "../engine/state";
import type { GameState, GamePhase } from "../engine/types";
import { Marquee } from "./Marquee";
import "./Game.css";

const HI_SCORE_KEY = "invaders.hiScore";

export type HudSnapshot = {
  score: number;
  hiScore: number;
  wave: number;
  lives: number;
  phase: GamePhase;
};

type Props = {
  /** Called whenever the HUD-projected slice of game state changes. The
   *  parent (InvadersStage) lifts these to drive <HudBar /> rendering. */
  onHud: (next: HudSnapshot) => void;
};

/* ── Game ─────────────────────────────────────────────────────────────
 * The playfield's mounted child. Owns the <canvas>, the game loop, and
 * the input handler. Forwards HUD-relevant state changes to the parent.
 * Tracks phase as local React state so the attract <Marquee /> can be
 * conditionally mounted — the CSS pulse + font polish carries over
 * instead of re-implementing it in canvas pixels.
 */
export function Game({ onHud }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>("attract");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pixel-perfect internal resolution. The CSS scales the visual size
    // — imageRendering: pixelated keeps blits crisp on upscale.
    canvas.width = PLAYFIELD_W;
    canvas.height = PLAYFIELD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const hiScore = readHiScore();
    const state = createInitialState(hiScore);

    const input = createInputHandler();

    // Last-emitted HUD snapshot. We compare against this to skip
    // redundant onHud calls — without this the parent setState fires
    // ~60 times/sec even when nothing the HUD cares about changed.
    let lastEmit: HudSnapshot = {
      score: -1,
      hiScore: -1,
      wave: -1,
      lives: -1,
      phase: "attract",
    };

    const emit = (s: GameState) => {
      if (
        s.score === lastEmit.score &&
        s.hiScore === lastEmit.hiScore &&
        s.wave === lastEmit.wave &&
        s.lives === lastEmit.lives &&
        s.phase === lastEmit.phase
      ) {
        return;
      }
      const next: HudSnapshot = {
        score: s.score,
        hiScore: s.hiScore,
        wave: s.wave,
        lives: s.lives,
        phase: s.phase,
      };
      if (next.phase !== lastEmit.phase) setPhase(next.phase);
      lastEmit = next;
      onHud(next);
    };

    // Initial HUD sync.
    emit(state);

    let lastSavedHi = hiScore;
    const loop = startLoop(ctx, state, input.state, (s) => {
      // Persist hi-score whenever it actually advances. Cheap (one
      // localStorage write per real new high). Wrapped in try/catch so
      // private-mode / blocked storage doesn't crash the loop.
      if (s.hiScore > lastSavedHi) {
        lastSavedHi = s.hiScore;
        try {
          localStorage.setItem(HI_SCORE_KEY, String(s.hiScore));
        } catch {
          // ignore — game keeps running, hi-score just won't persist
        }
      }
      emit(s);
    });

    return () => {
      loop.stop();
      input.dispose();
    };
  }, [onHud]);

  return (
    <div className="game-host" data-phase={phase}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Space Invaders playfield"
      />
      {phase !== "playing" && (
        <div className="game-attract">
          <Marquee />
          {phase === "gameOver" && (
            <div className="game-attract__over">GAME OVER</div>
          )}
        </div>
      )}
    </div>
  );
}

function readHiScore(): number {
  try {
    const v = Number(localStorage.getItem(HI_SCORE_KEY) ?? 0);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}
