import { POPUP_LIFE_S, POPUP_POOL_SIZE, POPUP_RISE_SPEED } from "./constants";
import type { ScorePopup } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · SCORE POPUPS
   Floating point values that rise off a kill and fade — the readout that
   makes the UFO bonus (which otherwise just vanishes) legible. Object-pool
   like the particle system: a fixed set of slots toggled via `alive`, no
   per-spawn allocation in the hot loop.
   ──────────────────────────────────────────────────────────────────────── */

export function createScorePopupPool(): ScorePopup[] {
  const pool: ScorePopup[] = [];
  for (let i = 0; i < POPUP_POOL_SIZE; i++) {
    pool.push({ x: 0, y: 0, value: 0, life: 0, maxLife: 0, alive: false });
  }
  return pool;
}

/** Raise a "+points" readout centered at (x, y). No-op if the pool is full
 *  (8 simultaneous popups is already more than a kill cadence produces). */
export function spawnPopup(pool: ScorePopup[], x: number, y: number, value: number): void {
  const p = pool.find((q) => !q.alive);
  if (!p) return;
  p.x = x;
  p.y = y;
  p.value = value;
  p.life = POPUP_LIFE_S;
  p.maxLife = POPUP_LIFE_S;
  p.alive = true;
}

/** Drift each live popup upward and age it out. */
export function stepPopups(pool: ScorePopup[], dt: number): void {
  for (const p of pool) {
    if (!p.alive) continue;
    p.y -= POPUP_RISE_SPEED * dt;
    p.life -= dt;
    if (p.life <= 0) p.alive = false;
  }
}
