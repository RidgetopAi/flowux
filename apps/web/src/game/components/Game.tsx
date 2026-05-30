import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioEngine, type AudioEngine } from "../engine/audio";
import { PLAYFIELD_H, PLAYFIELD_W } from "../engine/constants";
import { createInputHandler } from "../engine/input";
import { startLoop } from "../engine/loop";
import { createInitialState } from "../engine/state";
import type { GameState, GamePhase } from "../engine/types";
import { Marquee } from "./Marquee";
import "./Game.css";

const HI_SCORE_KEY = "invaders.hiScore";
const MUTE_KEY = "invaders.muted";

export type HudSnapshot = {
  score: number;
  hiScore: number;
  wave: number;
  lives: number;
  phase: GamePhase;
  /** True during the brief "WAVE N" announce between waves. */
  waveActive: boolean;
  /** True during the brief "1UP" flash when a bonus life is earned. */
  extraLifeActive: boolean;
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
  const audioRef = useRef<AudioEngine | null>(null);
  const [phase, setPhase] = useState<GamePhase>("attract");
  const [muted, setMuted] = useState<boolean>(readMuted);
  // The wave being announced during a transition, or null when no banner
  // should show. Driven from the loop via emit() below.
  const [waveBanner, setWaveBanner] = useState<number | null>(null);
  // True while the "1UP" bonus-life flash should show.
  const [oneUp, setOneUp] = useState(false);

  // Mute toggle shared by the M key and the on-screen button. Stable
  // identity so the keydown effect below doesn't re-bind every render.
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // ignore — mute just won't persist
      }
      return next;
    });
  }, []);

  // M toggles mute. Separate from the game loop effect so toggling doesn't
  // tear down and rebuild the loop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "m" || e.key === "M") toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute]);

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

    // ── Audio ──────────────────────────────────────────────────────────
    // The context starts suspended; the browser only lets us resume from
    // inside a user gesture. Resume on the first key/pointer event after
    // mount, then drop the listeners.
    const audio = createAudioEngine();
    audioRef.current = audio;
    audio.setMuted(readMuted());
    const resumeOnce = () => {
      audio.resume();
      window.removeEventListener("keydown", resumeOnce);
      window.removeEventListener("pointerdown", resumeOnce);
    };
    window.addEventListener("keydown", resumeOnce);
    window.addEventListener("pointerdown", resumeOnce);
    // Tracks the saucer's on-screen state so we start/stop the siren on
    // the transitions rather than every tick.
    let ufoWasActive = false;

    // Last-emitted HUD snapshot. We compare against this to skip
    // redundant onHud calls — without this the parent setState fires
    // ~60 times/sec even when nothing the HUD cares about changed.
    let lastEmit: HudSnapshot = {
      score: -1,
      hiScore: -1,
      wave: -1,
      lives: -1,
      phase: "attract",
      waveActive: false,
      extraLifeActive: false,
    };

    const emit = (s: GameState) => {
      const waveActive = s.waveFlash > 0;
      const extraLifeActive = s.extraLifeFlash > 0;
      if (
        s.score === lastEmit.score &&
        s.hiScore === lastEmit.hiScore &&
        s.wave === lastEmit.wave &&
        s.lives === lastEmit.lives &&
        s.phase === lastEmit.phase &&
        waveActive === lastEmit.waveActive &&
        extraLifeActive === lastEmit.extraLifeActive
      ) {
        return;
      }
      const next: HudSnapshot = {
        score: s.score,
        hiScore: s.hiScore,
        wave: s.wave,
        lives: s.lives,
        phase: s.phase,
        waveActive,
        extraLifeActive,
      };
      if (next.phase !== lastEmit.phase) setPhase(next.phase);
      // Show "WAVE N" while the announce is active; clear it when it ends.
      if (next.waveActive !== lastEmit.waveActive || next.wave !== lastEmit.wave) {
        setWaveBanner(next.waveActive ? next.wave : null);
      }
      if (next.extraLifeActive !== lastEmit.extraLifeActive) {
        setOneUp(next.extraLifeActive);
      }
      lastEmit = next;
      onHud(next);
    };

    // Initial HUD sync.
    emit(state);

    let lastSavedHi = hiScore;
    const loop = startLoop(ctx, state, input.state, (s, notice) => {
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

      // ── Sound events ──────────────────────────────────────────────────
      if (notice.shotFired) audio.shoot();
      if (notice.alienKilled) audio.alienExplosion();
      if (notice.ufoKilled) audio.ufoExplosion();
      if (notice.playerKilled) audio.playerExplosion();
      if (notice.marchStepped) audio.marchStep();
      if (notice.extraLife) audio.extraLife();
      // Siren only while the saucer is actually on a live playfield — also
      // cuts it the instant the game ends or the wave clears.
      const ufoActive = s.phase === "playing" && s.ufo.active;
      if (ufoActive && !ufoWasActive) audio.ufoOn();
      else if (!ufoActive && ufoWasActive) audio.ufoOff();
      ufoWasActive = ufoActive;
    });

    return () => {
      loop.stop();
      input.dispose();
      window.removeEventListener("keydown", resumeOnce);
      window.removeEventListener("pointerdown", resumeOnce);
      audio.dispose();
      audioRef.current = null;
    };
  }, [onHud]);

  return (
    <div className="game-host" data-phase={phase}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Space Invaders playfield"
      />
      <button
        type="button"
        className="game-mute"
        onClick={(e) => {
          toggleMute();
          // Hand focus back so Space keeps firing instead of re-clicking.
          e.currentTarget.blur();
        }}
        aria-label={muted ? "Unmute sound (M)" : "Mute sound (M)"}
        aria-pressed={muted}
        data-muted={muted}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
      {phase === "attract" && (
        <div className="game-attract game-attract--demo">
          {/* The demo plays behind this — keep the prompt compact so it
              never competes with the dancing formation. */}
          <div className="game-prompt">PRESS START</div>
          <div className="game-prompt__coin">INSERT 1 COIN</div>
        </div>
      )}
      {phase === "gameOver" && (
        <div className="game-attract">
          <div className="game-attract__over">GAME OVER</div>
          <Marquee />
        </div>
      )}
      {waveBanner !== null && (
        <div className="game-wave" aria-hidden="true">
          WAVE {waveBanner}
        </div>
      )}
      {oneUp && (
        <div className="game-oneup" aria-hidden="true">
          1UP
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

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
