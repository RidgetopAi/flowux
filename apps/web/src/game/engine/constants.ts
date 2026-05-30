/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · CONSTANTS
   The numeric soul of the game. Every dimension, speed, and rate lives
   here so balancing happens in one place. CSS canvas size scales these
   visually; the simulation always works in this fixed integer grid.

   The native resolution (PLAYFIELD_W × PLAYFIELD_H) is sized close to
   the original arcade (224×256) but stretched to 5:6 so it fills the
   Playfield component's aspect ratio without letterboxing.
   ──────────────────────────────────────────────────────────────────────── */

/* ── PLAYFIELD ──────────────────────────────────────────────────────── */

export const PLAYFIELD_W = 200;
export const PLAYFIELD_H = 240;

/** Fixed simulation step. 60Hz logic regardless of rAF rate. */
export const FIXED_STEP_S = 1 / 60;
/** Hard cap on accumulated time per frame — prevents the spiral-of-death
 *  when a tab returns from background with a huge dt. */
export const MAX_FRAME_S = 0.25;

/* ── PLAYER ─────────────────────────────────────────────────────────── */

export const PLAYER_W = 14;
export const PLAYER_H = 8;
export const PLAYER_Y = PLAYFIELD_H - 18;
export const PLAYER_SPEED = 70; // px/s
export const PLAYER_INVULN_S = 1.6; // after death-respawn

/* ── PLAYER BULLET ──────────────────────────────────────────────────── */

export const BULLET_W = 1;
export const BULLET_H = 5;
export const PLAYER_BULLET_SPEED = 140; // px/s, upward

/* ── ALIEN GRID ─────────────────────────────────────────────────────── */

export const ALIEN_COLS = 11;
export const ALIEN_ROWS = 5;
export const ALIEN_W = 12;
export const ALIEN_H = 8;
/** Horizontal stride between aliens (col-to-col, leading edge). */
export const ALIEN_GAP_X = 4;
/** Vertical stride between alien rows. */
export const ALIEN_GAP_Y = 8;
/** Where the grid's top-left lives at wave 1 start. */
export const ALIEN_GRID_START_X = 14;
export const ALIEN_GRID_START_Y = 30;
/** Each wave bumps the starting Y down by this. */
export const ALIEN_WAVE_DROP = 10;
/** "WAVE N" announce duration between clearing a wave and the next
 *  formation dropping in — a short arcade breather. */
export const WAVE_FLASH_S = 1.6;
/** Pixels the formation translates per march step. */
export const ALIEN_MARCH_DX = 2;
/** Pixels the formation drops when it hits a wall. */
export const ALIEN_MARCH_DY = 8;

/** Step interval bounds — tempo locked to alive-alien count. With all
 *  55 aliens alive we get ~1 step/sec (sloooow doom...doom...doom).
 *  With 1 alien left we get ~16 steps/sec (frantic chase). The lerp is
 *  what gives Space Invaders its iconic anxiety arc. */
export const ALIEN_STEP_INTERVAL_MAX_S = 1.0;
export const ALIEN_STEP_INTERVAL_MIN_S = 0.06;

/** Per-row point values, top row = most points. */
export const ALIEN_ROW_POINTS = [30, 20, 20, 10, 10];

/* ── UFO (mystery saucer) ───────────────────────────────────────────── */

export const UFO_W = 16;
export const UFO_H = 8;
/** Cruising altitude — above the formation's wave-1 top, below the HUD. */
export const UFO_Y = 16;
export const UFO_SPEED = 40; // px/s, horizontal
/** Seconds between passes. The saucer is a periodic bonus, not constant. */
export const UFO_INTERVAL_S = 25;
/** Bonus values. Picked deterministically by player shot-count (see
 *  update.ts) so the pattern is learnable — the arcade's hidden reward
 *  for players who count their shots. */
export const UFO_POINTS_TABLE = [50, 100, 150, 300];

/* ── BUNKERS ────────────────────────────────────────────────────────── */

export const BUNKER_W = 22;
export const BUNKER_H = 16;
export const BUNKER_COUNT = 4;
/** Top of the bunker row — a comfortable gap above the player's turret. */
export const BUNKER_Y = PLAYER_Y - 30;
/** Carve radius (px) per bullet impact. Small bites; many hits to clear. */
export const BUNKER_DAMAGE_RADIUS_PX = 2;

/* ── PARTICLES ──────────────────────────────────────────────────────── */

export const PARTICLE_POOL_SIZE = 64;
export const PARTICLE_LIFE_S = 0.4;
export const PARTICLE_GRAVITY = 80; // px/s² downward pull on sparks
export const PARTICLE_PER_ALIEN = 6;
export const PARTICLE_PER_PLAYER = 14;

/* ── SCORE POPUPS ───────────────────────────────────────────────────── */

export const POPUP_POOL_SIZE = 8;
/** How long a "+points" readout lingers before it fully fades. */
export const POPUP_LIFE_S = 0.9;
/** Upward drift speed of a floating score, px/s. */
export const POPUP_RISE_SPEED = 14;

/* ── ALIEN BULLETS ──────────────────────────────────────────────────── */

export const ALIEN_BULLET_SPEED = 60; // px/s, downward
/** Average seconds between alien bullet spawns. Real interval is jittered
 *  uniformly in [min, max] for unpredictability. */
export const ALIEN_FIRE_INTERVAL_MIN_S = 0.9;
export const ALIEN_FIRE_INTERVAL_MAX_S = 2.2;
/** Hard cap on alien bullets in flight at once. */
export const ALIEN_BULLET_MAX = 3;

/* ── COLORS (canvas) ────────────────────────────────────────────────── */

/** Phosphor palette for the canvas — keep close to tokens.css but in raw
 *  hex form since the canvas API doesn't read CSS variables. */
export const COLOR_PLAYER = "#a8fff1";
export const COLOR_BULLET = "#d4fff7";
export const COLOR_ALIEN_ROW = [
  "#c7bdff", // row 0 — top, violet (the mystery row look)
  "#ff8a5c", // row 1 — Claude coral (the Claude mascot row)
  "#a8fff1", // row 2 — cyan
  "#b8ffba", // row 3 — green
  "#b8ffba", // row 4 — green
];
export const COLOR_ALIEN_BULLET = "#ff9b9b";
/** UFO two-tone: cyan hull, amber dome (the mystery-row accent palette). */
export const COLOR_UFO_BODY = "#a8fff1";
export const COLOR_UFO_DOME = "#ffcf8b";
/** Bunker phosphor — a distinct green from the bottom alien rows so the
 *  shields read as a separate object class, not stray aliens. */
export const COLOR_BUNKER = "#74f7a0";
/** Score popups — a warm gold so floating points read as "score", clearly
 *  distinct from the cool phosphor entities and the hot explosion sparks. */
export const COLOR_POPUP = "#ffe7a8";
