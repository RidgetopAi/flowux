import { createBunkerMask } from "../sprites/bunker";
import {
  ALIEN_BULLET_MAX,
  ALIEN_COLS,
  ALIEN_GAP_X,
  ALIEN_GAP_Y,
  ALIEN_GRID_START_X,
  ALIEN_GRID_START_Y,
  ALIEN_ROWS,
  ALIEN_W,
  ALIEN_WAVE_DROP,
  BUNKER_COUNT,
  BUNKER_W,
  BUNKER_Y,
  PLAYER_Y,
  PLAYFIELD_W,
  UFO_INTERVAL_S,
} from "./constants";
import { createParticlePool } from "./particles";
import type { Alien, AlienBullet, Bunker, GameState, Player, Ufo } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · STATE FACTORIES
   Pure constructors for fresh game states. Mutation happens elsewhere.
   ──────────────────────────────────────────────────────────────────────── */

/** Fresh, brand-new game session. Wave 1, lives full, attract waiting. */
export function createInitialState(hiScore = 0): GameState {
  return {
    phase: "attract",
    time: 0,
    score: 0,
    hiScore,
    wave: 1,
    lives: 3,
    player: createPlayer(),
    playerBullet: { x: 0, y: 0, alive: false },
    aliens: createAlienGrid(1),
    aliveCount: ALIEN_COLS * ALIEN_ROWS,
    march: {
      dir: 1,
      untilStep: 1.0,
      edgeHit: false,
      frame: 0,
    },
    alienBullets: createAlienBulletPool(),
    untilAlienFire: 1.5,
    ufo: createUfo(),
    untilUfo: UFO_INTERVAL_S,
    shotCount: 0,
    bunkers: createBunkers(),
    particles: createParticlePool(),
  };
}

/** Full brand-new-game reset, in place — score / wave / lives / shot
 *  count back to start, board rebuilt at wave 1. Hi-score is the one thing
 *  preserved (it's the persisted record). Shared by the real attract→play
 *  start and the attract demo's self-loop, so both stay identical. */
export function resetForNewGame(state: GameState): void {
  state.score = 0;
  state.wave = 1;
  state.lives = 3;
  state.shotCount = 0;
  resetForPlay(state, 1);
}

/** Reset to a "fresh play" but keep score / hi-score / wave / lives.
 *  Used after a player death or starting from the attract screen. */
export function resetForPlay(state: GameState, wave: number): void {
  state.player = createPlayer();
  state.playerBullet.alive = false;
  state.aliens = createAlienGrid(wave);
  state.aliveCount = ALIEN_COLS * ALIEN_ROWS;
  state.march.dir = 1;
  state.march.untilStep = 1.0;
  state.march.edgeHit = false;
  state.march.frame = 0;
  for (const b of state.alienBullets) b.alive = false;
  state.untilAlienFire = 1.5;
  state.ufo.active = false;
  state.untilUfo = UFO_INTERVAL_S;
  state.bunkers = createBunkers();
  for (const p of state.particles) p.alive = false;
  state.time = 0;
}

/** Player ship at its spawn position — bottom center of the playfield. */
export function createPlayer(): Player {
  return {
    x: PLAYFIELD_W / 2,
    y: PLAYER_Y,
    invulnUntil: 0,
    bulletAlive: false,
  };
}

/** Build the 55-alien formation for a given wave. Higher waves push the
 *  whole grid downward — the player has less air to maneuver in. */
export function createAlienGrid(wave: number): Alien[] {
  const aliens: Alien[] = [];
  const dy = ALIEN_WAVE_DROP * Math.max(0, wave - 1);

  for (let row = 0; row < ALIEN_ROWS; row++) {
    for (let col = 0; col < ALIEN_COLS; col++) {
      aliens.push({
        x: ALIEN_GRID_START_X + col * (ALIEN_W + ALIEN_GAP_X),
        y: ALIEN_GRID_START_Y + dy + row * (8 + ALIEN_GAP_Y),
        row,
        col,
        alive: true,
      });
    }
  }
  return aliens;
}

/** Inactive saucer, parked off-screen until its timer fires. */
export function createUfo(): Ufo {
  return { x: 0, y: 0, active: false, points: 0, dir: 1 };
}

/** Build the row of intact bunkers, evenly spaced across the playfield
 *  with matched margins on both ends. Each gets its own fresh mask canvas
 *  — the live damage surface. */
export function createBunkers(): Bunker[] {
  const gap = (PLAYFIELD_W - BUNKER_COUNT * BUNKER_W) / (BUNKER_COUNT + 1);
  const bunkers: Bunker[] = [];
  for (let i = 0; i < BUNKER_COUNT; i++) {
    bunkers.push({
      x: Math.round(gap * (i + 1) + BUNKER_W * i),
      y: BUNKER_Y,
      mask: createBunkerMask(),
    });
  }
  return bunkers;
}

/** Pre-allocated alien bullet pool. We never spawn beyond ALIEN_BULLET_MAX
 *  in flight, so a fixed array of "slots" toggles their alive flag
 *  instead of churning the heap. */
export function createAlienBulletPool(): AlienBullet[] {
  const pool: AlienBullet[] = [];
  for (let i = 0; i < ALIEN_BULLET_MAX; i++) {
    pool.push({ x: 0, y: 0, alive: false });
  }
  return pool;
}
