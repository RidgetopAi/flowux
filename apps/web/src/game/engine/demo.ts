import { ALIEN_W } from "./constants";
import type { InputState } from "./input";
import type { Alien, GameState } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · ATTRACT-MODE DEMO BOT
   A stateless controller that reads the live GameState and returns a
   synthetic InputState — the same shape the keyboard produces — so the
   attract screen drives the REAL simulate() and plays itself.

   Stateless on purpose: deciding move/fire purely from the current frame
   keeps it simple and crash-proof (no memory to desync on a demo reset).
   The single-bullet rule already paces firing; a small deadzone kills the
   left/right jitter that a memoryless aimer would otherwise produce.
   ──────────────────────────────────────────────────────────────────────── */

/** Horizontal danger zone — an alien bullet whose x is within this of the
 *  turret is treated as incoming and dodged before anything else. */
const DODGE_X = 9;
/** Aim deadzone — fire once the target column center is within this of the
 *  turret. Wider than 1px so the bot doesn't twitch hunting a perfect line. */
const AIM_TOL = 3;

/** Decide this frame's bot input from the board. Pure read of `state`. */
export function demoInput(state: GameState): InputState {
  const input: InputState = {
    left: false,
    right: false,
    firePressed: false,
    startPressed: false,
  };
  const px = state.player.x;

  // ── Dodge incoming fire (overrides aiming) ───────────────────────────
  // Strafe away from the nearest alien bullet still above the turret.
  let nearestDx = Infinity;
  for (const b of state.alienBullets) {
    if (!b.alive || b.y >= state.player.y) continue;
    const dx = b.x - px;
    if (Math.abs(dx) < DODGE_X && Math.abs(dx) < Math.abs(nearestDx)) {
      nearestDx = dx;
    }
  }
  if (nearestDx !== Infinity) {
    // Bullet on our right → break left, and vice-versa. Dead-center ties
    // break left (nearestDx === 0 is rare but deterministic).
    if (nearestDx > 0) input.left = true;
    else input.right = true;
    return input;
  }

  // ── Hunt: line up under the lowest-most alien and fire ───────────────
  // The bottom-most alien is both the biggest threat and the one clear of
  // its own column — shooting it peels the formation bottom-up, the way a
  // human plays. Ties on y resolve to whichever the loop sees last; the
  // deadzone keeps that from causing oscillation.
  let target: Alien | null = null;
  for (const a of state.aliens) {
    if (!a.alive) continue;
    if (target === null || a.y > target.y) target = a;
  }
  if (target) {
    const targetX = target.x + ALIEN_W / 2;
    if (targetX < px - AIM_TOL) input.left = true;
    else if (targetX > px + AIM_TOL) input.right = true;
    else input.firePressed = true; // aligned — single-bullet rule paces it
  }

  return input;
}
