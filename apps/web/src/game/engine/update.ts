import { carveBunker, sampleBunker } from "../sprites/bunker";
import {
  ALIEN_BULLET_SPEED,
  ALIEN_COLS,
  ALIEN_FIRE_INTERVAL_MAX_S,
  ALIEN_FIRE_INTERVAL_MIN_S,
  ALIEN_H,
  ALIEN_MARCH_DX,
  ALIEN_MARCH_DY,
  ALIEN_ROW_POINTS,
  ALIEN_ROWS,
  ALIEN_STEP_INTERVAL_MAX_S,
  ALIEN_STEP_INTERVAL_MIN_S,
  ALIEN_W,
  BULLET_H,
  BUNKER_DAMAGE_RADIUS_PX,
  BUNKER_H,
  BUNKER_W,
  COLOR_ALIEN_ROW,
  COLOR_PLAYER,
  COLOR_UFO_BODY,
  PARTICLE_PER_ALIEN,
  PARTICLE_PER_PLAYER,
  PLAYER_BULLET_SPEED,
  PLAYER_H,
  PLAYER_INVULN_S,
  PLAYER_SPEED,
  PLAYER_W,
  PLAYFIELD_H,
  PLAYFIELD_W,
  UFO_H,
  UFO_INTERVAL_S,
  UFO_POINTS_TABLE,
  UFO_SPEED,
  UFO_W,
  UFO_Y,
} from "./constants";
import type { InputState } from "./input";
import { spawnBurst, stepParticles } from "./particles";
import { createAlienGrid, createBunkers, createPlayer } from "./state";
import type { Alien, Bunker, GameState } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · SIMULATION
   Mutates GameState in place each fixed timestep. Pure of side effects
   beyond the input state object (whose edge-trigger flags we consume).
   Layout (in execution order):

     phase transitions  →  time  →  player move
     player fire        →  player bullet ↑  + collisions
     alien march tick   →  side-step / drop+reverse
     alien fire tick    →  spawn from bottom of random alive column
     alien bullets ↓    +  collisions with player
     wave clear / game over checks

   The functions below are split out so each step is small and testable —
   the simulation is the part that has to be right, so it has the most
   structure.
   ──────────────────────────────────────────────────────────────────────── */

export type UpdateNotice = {
  /** True when this step ended the game (lives → 0 or aliens landed). */
  gameOver?: boolean;
  /** True when this step cleared the wave (last alien killed). */
  waveCleared?: boolean;
  /** Score delta from this step's kills. Loop forwards to HUD. */
  scoreDelta?: number;
  /* ── Sound events (Phase 4). The sim stays pure — it only flags what
     happened; the Game layer turns these into Web Audio. ── */
  /** Player fired a bullet this step. */
  shotFired?: boolean;
  /** An alien was destroyed by the player bullet. */
  alienKilled?: boolean;
  /** The player ship was hit. */
  playerKilled?: boolean;
  /** The UFO was shot down. */
  ufoKilled?: boolean;
  /** The formation took a march step (drives the heartbeat tempo). */
  marchStepped?: boolean;
};

/** Tick the simulation forward by FIXED_STEP_S seconds. Returns a notice
 *  the loop uses to drive HUD updates and phase transitions. */
export function update(state: GameState, dt: number, input: InputState): UpdateNotice {
  const notice: UpdateNotice = {};

  // ── Phase transitions ────────────────────────────────────────────────
  if (state.phase === "attract" && input.startPressed) {
    input.startPressed = false;
    state.phase = "playing";
    state.score = 0;
    state.wave = 1;
    state.lives = 3;
    state.time = 0;
    state.aliens = createAlienGrid(1);
    state.aliveCount = ALIEN_COLS * ALIEN_ROWS;
    state.player = createPlayer();
    state.playerBullet.alive = false;
    state.march.dir = 1;
    state.march.untilStep = 1.0;
    state.march.edgeHit = false;
    state.march.frame = 0;
    for (const b of state.alienBullets) b.alive = false;
    state.untilAlienFire = 1.5;
    state.ufo.active = false;
    state.untilUfo = UFO_INTERVAL_S;
    state.shotCount = 0;
    state.bunkers = createBunkers();
    for (const p of state.particles) p.alive = false;
  } else if (state.phase === "gameOver" && input.startPressed) {
    input.startPressed = false;
    state.phase = "attract";
  }

  // While not playing, drain edge triggers and skip the rest of the sim.
  // (Keeps the canvas alive for the future attract-mode demo dance.)
  if (state.phase !== "playing") {
    input.firePressed = false;
    return notice;
  }

  state.time += dt;

  // ── Player movement ──────────────────────────────────────────────────
  if (input.left && !input.right) {
    state.player.x -= PLAYER_SPEED * dt;
  } else if (input.right && !input.left) {
    state.player.x += PLAYER_SPEED * dt;
  }
  // Clamp to playfield bounds.
  const halfW = PLAYER_W / 2;
  if (state.player.x < halfW + 1) state.player.x = halfW + 1;
  if (state.player.x > PLAYFIELD_W - halfW - 1) {
    state.player.x = PLAYFIELD_W - halfW - 1;
  }

  // ── Player fire (single-bullet rule) ─────────────────────────────────
  if (input.firePressed) {
    input.firePressed = false;
    if (!state.playerBullet.alive) {
      state.playerBullet.alive = true;
      state.playerBullet.x = state.player.x;
      state.playerBullet.y = state.player.y - PLAYER_H / 2 - BULLET_H;
      // Shot count drives the deterministic UFO bonus value (arcade trick).
      state.shotCount += 1;
      notice.shotFired = true;
    }
  }

  // ── Player bullet step + collisions ──────────────────────────────────
  // Travelling upward, so it meets bunkers (lowest) before aliens before
  // the UFO (highest). First solid thing it touches consumes it.
  if (state.playerBullet.alive) {
    state.playerBullet.y -= PLAYER_BULLET_SPEED * dt;
    const bx = state.playerBullet.x;
    const by = state.playerBullet.y; // leading (top) edge going up
    if (by + BULLET_H < 0) {
      state.playerBullet.alive = false;
    } else if (carveBunkerAt(state.bunkers, bx, by)) {
      state.playerBullet.alive = false;
    } else {
      const kill = findAlienHit(state.aliens, bx, by);
      if (kill !== null) {
        const alien = state.aliens[kill];
        if (alien) {
          alien.alive = false;
          state.aliveCount -= 1;
          state.playerBullet.alive = false;
          const points = ALIEN_ROW_POINTS[alien.row] ?? 10;
          state.score += points;
          notice.scoreDelta = (notice.scoreDelta ?? 0) + points;
          notice.alienKilled = true;
          spawnBurst(state.particles, alien.x + ALIEN_W / 2, alien.y + ALIEN_H / 2, {
            count: PARTICLE_PER_ALIEN,
            color: COLOR_ALIEN_ROW[alien.row] ?? COLOR_PLAYER,
          });
        }
      } else if (state.ufo.active && ufoHit(state.ufo.x, bx, by)) {
        state.playerBullet.alive = false;
        state.score += state.ufo.points;
        notice.scoreDelta = (notice.scoreDelta ?? 0) + state.ufo.points;
        notice.ufoKilled = true;
        spawnBurst(state.particles, state.ufo.x, UFO_Y + UFO_H / 2, {
          count: PARTICLE_PER_ALIEN + 4,
          color: COLOR_UFO_BODY,
          speedMax: 120,
        });
        state.ufo.active = false;
      }
    }
  }

  // ── UFO pass ─────────────────────────────────────────────────────────
  updateUfo(state, dt);

  // ── Alien march ──────────────────────────────────────────────────────
  state.march.untilStep -= dt;
  if (state.march.untilStep <= 0) {
    stepAliens(state);
    state.march.untilStep += currentStepInterval(state.aliveCount);
    notice.marchStepped = true;
  }

  // ── Alien fire ───────────────────────────────────────────────────────
  state.untilAlienFire -= dt;
  if (state.untilAlienFire <= 0) {
    tryFireAlien(state);
    state.untilAlienFire =
      ALIEN_FIRE_INTERVAL_MIN_S +
      Math.random() * (ALIEN_FIRE_INTERVAL_MAX_S - ALIEN_FIRE_INTERVAL_MIN_S);
  }

  // ── Alien bullets step + collisions ──────────────────────────────────
  for (const b of state.alienBullets) {
    if (!b.alive) continue;
    b.y += ALIEN_BULLET_SPEED * dt;
    if (b.y > PLAYFIELD_H) {
      b.alive = false;
      continue;
    }
    // Bunkers eat alien fire from above — sample at the bullet's leading
    // (bottom) edge. Carving happens even during the player's invuln.
    if (carveBunkerAt(state.bunkers, b.x, b.y + BULLET_H)) {
      b.alive = false;
      continue;
    }
    if (state.time < state.player.invulnUntil) continue;
    if (playerHit(state, b.x, b.y)) {
      b.alive = false;
      onPlayerHit(state);
      notice.playerKilled = true;
      if (state.lives <= 0) {
        state.phase = "gameOver";
        notice.gameOver = true;
        return notice;
      }
    }
  }

  // ── Particle simulation ──────────────────────────────────────────────
  stepParticles(state.particles, dt);

  // ── Wave clear ───────────────────────────────────────────────────────
  if (state.aliveCount === 0) {
    state.wave += 1;
    state.aliens = createAlienGrid(state.wave);
    state.aliveCount = ALIEN_COLS * ALIEN_ROWS;
    state.march.dir = 1;
    state.march.untilStep = 1.0;
    state.march.edgeHit = false;
    state.march.frame = 0;
    for (const b of state.alienBullets) b.alive = false;
    state.untilAlienFire = 1.2;
    // Fresh shields each wave — the player earns a clean slate of cover.
    state.bunkers = createBunkers();
    state.ufo.active = false;
    state.untilUfo = UFO_INTERVAL_S;
    notice.waveCleared = true;
  }

  // ── Aliens reach player Y → instant game over ────────────────────────
  for (const a of state.aliens) {
    if (!a.alive) continue;
    if (a.y + ALIEN_H >= state.player.y - PLAYER_H / 2) {
      state.phase = "gameOver";
      state.lives = 0;
      notice.gameOver = true;
      break;
    }
  }

  // Hi-score bookkeeping.
  if (state.score > state.hiScore) state.hiScore = state.score;

  return notice;
}

/* ── March mechanics ─────────────────────────────────────────────────── */

function stepAliens(state: GameState): void {
  // Every step is also an animation frame — flip the walk bit so the swarm
  // shuffles in lockstep with its advance.
  state.march.frame = state.march.frame === 0 ? 1 : 0;

  if (state.march.edgeHit) {
    // Drop + reverse this step.
    for (const a of state.aliens) {
      if (!a.alive) continue;
      a.y += ALIEN_MARCH_DY;
    }
    state.march.dir = (state.march.dir * -1) as -1 | 1;
    state.march.edgeHit = false;
    return;
  }

  // Side-step.
  const dx = ALIEN_MARCH_DX * state.march.dir;
  for (const a of state.aliens) {
    if (!a.alive) continue;
    a.x += dx;
  }

  // Edge detection AFTER the step. If any alive alien is now past the
  // wall, queue a drop+reverse for next step. Classic behavior — the
  // formation marches one step into the wall before dropping.
  let minX = Infinity;
  let maxX = -Infinity;
  for (const a of state.aliens) {
    if (!a.alive) continue;
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
  }
  if (state.march.dir === 1 && maxX + ALIEN_W >= PLAYFIELD_W - 1) {
    state.march.edgeHit = true;
  } else if (state.march.dir === -1 && minX <= 1) {
    state.march.edgeHit = true;
  }
}

/** Lerp the step interval between MAX (slow, many aliens) and MIN (fast,
 *  few aliens). The (alive / total) ratio gives the iconic anxiety curve. */
function currentStepInterval(aliveCount: number): number {
  const total = ALIEN_COLS * ALIEN_ROWS;
  const ratio = Math.max(0, Math.min(1, aliveCount / total));
  return (
    ALIEN_STEP_INTERVAL_MIN_S +
    (ALIEN_STEP_INTERVAL_MAX_S - ALIEN_STEP_INTERVAL_MIN_S) * ratio
  );
}

/* ── Alien fire pick ─────────────────────────────────────────────────── */

function tryFireAlien(state: GameState): void {
  // Find a free bullet slot.
  const slot = state.alienBullets.find((b) => !b.alive);
  if (!slot) return;

  // Build a list of alive columns (each at most once). Then pick one
  // uniformly. Within that column, the bottom-most alive alien fires.
  const cols: number[] = [];
  const seen = new Uint8Array(ALIEN_COLS);
  for (const a of state.aliens) {
    if (!a.alive) continue;
    if (seen[a.col]) continue;
    seen[a.col] = 1;
    cols.push(a.col);
  }
  if (cols.length === 0) return;

  const pickCol = cols[(Math.random() * cols.length) | 0];
  let bottom: Alien | null = null;
  for (const a of state.aliens) {
    if (!a.alive || a.col !== pickCol) continue;
    if (bottom === null || a.y > bottom.y) bottom = a;
  }
  if (!bottom) return;

  slot.alive = true;
  slot.x = bottom.x + ALIEN_W / 2;
  slot.y = bottom.y + ALIEN_H;
}

/* ── Hit-tests (AABB) ────────────────────────────────────────────────── */

/** Returns the index of the first alive alien whose AABB contains the
 *  bullet head, or null. Player bullets are 1×N — we treat them as a
 *  point at (x, y). */
function findAlienHit(aliens: Alien[], bx: number, by: number): number | null {
  for (let i = 0; i < aliens.length; i++) {
    const a = aliens[i];
    if (!a || !a.alive) continue;
    if (
      bx >= a.x &&
      bx <= a.x + ALIEN_W &&
      by >= a.y &&
      by <= a.y + ALIEN_H
    ) {
      return i;
    }
  }
  return null;
}

function playerHit(state: GameState, bx: number, by: number): boolean {
  const halfW = PLAYER_W / 2;
  const halfH = PLAYER_H / 2;
  return (
    bx >= state.player.x - halfW &&
    bx <= state.player.x + halfW &&
    by >= state.player.y - halfH &&
    by <= state.player.y + halfH + BULLET_H
  );
}

function onPlayerHit(state: GameState): void {
  state.lives -= 1;
  state.player.invulnUntil = state.time + PLAYER_INVULN_S;
  // Bullet cleared so the player can shoot again immediately.
  state.playerBullet.alive = false;
  // A heavier, slower, longer-lived burst — the player's death should feel
  // weightier than an alien pop.
  spawnBurst(state.particles, state.player.x, state.player.y, {
    count: PARTICLE_PER_PLAYER,
    color: COLOR_PLAYER,
    speedMin: 15,
    speedMax: 55,
    life: 0.7,
  });
}

/* ── UFO mechanics ───────────────────────────────────────────────────── */

function updateUfo(state: GameState, dt: number): void {
  const ufo = state.ufo;
  if (!ufo.active) {
    state.untilUfo -= dt;
    if (state.untilUfo <= 0) {
      // Alternate entry side each pass; bonus is deterministic by shot
      // count so attentive players can time the 300.
      ufo.dir = (ufo.dir * -1) as -1 | 1;
      ufo.active = true;
      ufo.y = UFO_Y;
      ufo.x = ufo.dir === 1 ? -UFO_W / 2 : PLAYFIELD_W + UFO_W / 2;
      ufo.points = UFO_POINTS_TABLE[state.shotCount % UFO_POINTS_TABLE.length] ?? 100;
      state.untilUfo = UFO_INTERVAL_S;
    }
    return;
  }

  ufo.x += UFO_SPEED * ufo.dir * dt;
  // Deactivate once fully off the far edge.
  if (ufo.dir === 1 && ufo.x - UFO_W / 2 > PLAYFIELD_W) ufo.active = false;
  if (ufo.dir === -1 && ufo.x + UFO_W / 2 < 0) ufo.active = false;
}

/** Point-in-UFO AABB test. The saucer is drawn centered on ufo.x with its
 *  top at UFO_Y. */
function ufoHit(ufoX: number, bx: number, by: number): boolean {
  return (
    bx >= ufoX - UFO_W / 2 &&
    bx <= ufoX + UFO_W / 2 &&
    by >= UFO_Y &&
    by <= UFO_Y + UFO_H
  );
}

/* ── Bunker collision ────────────────────────────────────────────────── */

/** If (px, py) lands on a solid bunker pixel, erode a disc there and
 *  report the hit. Walks bunkers in order; the first solid one wins. */
function carveBunkerAt(bunkers: Bunker[], px: number, py: number): boolean {
  for (const bk of bunkers) {
    const lx = px - bk.x;
    const ly = py - bk.y;
    if (lx < 0 || ly < 0 || lx >= BUNKER_W || ly >= BUNKER_H) continue;
    if (sampleBunker(bk.mask, lx, ly)) {
      carveBunker(bk.mask, lx, ly, BUNKER_DAMAGE_RADIUS_PX);
      return true;
    }
  }
  return false;
}
