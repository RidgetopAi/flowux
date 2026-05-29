import { FIXED_STEP_S, MAX_FRAME_S } from "./constants";
import type { InputState } from "./input";
import { render } from "./render";
import type { GameState } from "./types";
import { update, type UpdateNotice } from "./update";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · GAME LOOP
   rAF-driven, fixed-timestep simulation with an interpolation-free
   render. Simulation always advances in FIXED_STEP_S chunks regardless
   of monitor refresh — keeps physics deterministic across 60/120/144Hz.

   Accumulator pattern:
     - dt = (now - last) / 1000, clamped to MAX_FRAME_S
     - acc += dt
     - while acc >= FIXED_STEP_S: simulate one step, acc -= FIXED_STEP_S
     - render once after the step loop

   The interpolation-free render is a deliberate choice: we want pixel-
   exact integer positions in canvas, not sub-pixel smearing. At 60Hz
   logic with 60Hz monitors the cadence is 1:1; on higher monitors the
   render frame doesn't tick the sim but still shows the latest state.
   ──────────────────────────────────────────────────────────────────────── */

export type LoopHandle = {
  stop: () => void;
};

export type OnTickCallback = (state: GameState, notice: UpdateNotice) => void;

/** Start the game loop. Returns a handle whose stop() cancels the
 *  current rAF and prevents further ticks. Safe to call multiple times
 *  — each call replaces any in-flight loop. */
export function startLoop(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  input: InputState,
  onTick: OnTickCallback,
): LoopHandle {
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let stopped = false;

  const frame = (now: number) => {
    if (stopped) return;
    const dtRaw = (now - last) / 1000;
    last = now;
    // Clamp to keep the accumulator from exploding after a tab switch.
    const dt = Math.min(dtRaw, MAX_FRAME_S);
    acc += dt;

    // Aggregate notices across all fixed steps in this frame — the loop
    // may consume multiple sim ticks per render at lower monitor rates
    // or during catch-up after a stall.
    const notice: UpdateNotice = {};
    while (acc >= FIXED_STEP_S) {
      const stepNotice = update(state, FIXED_STEP_S, input);
      if (stepNotice.gameOver) notice.gameOver = true;
      if (stepNotice.waveCleared) notice.waveCleared = true;
      if (stepNotice.scoreDelta) {
        notice.scoreDelta = (notice.scoreDelta ?? 0) + stepNotice.scoreDelta;
      }
      acc -= FIXED_STEP_S;
    }

    render(ctx, state);
    onTick(state, notice);

    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
