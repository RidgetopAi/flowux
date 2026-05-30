/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · TYPES
   Core simulation types. Held in a single mutable GameState object that
   the loop ticks and renders. No nested immutability — this is a real-
   time game loop, not a Redux store.
   ──────────────────────────────────────────────────────────────────────── */

/** High-level game phase. Drives which UI overlays render and what the
 *  loop is allowed to do. */
export type GamePhase = "attract" | "playing" | "gameOver";

/** Direction of the alien formation's horizontal march. */
export type MarchDir = -1 | 1;

export type Vec2 = { x: number; y: number };

export type Player = {
  /** Center-x of the ship (we render with width PLAYER_W centered here). */
  x: number;
  y: number;
  /** True while a death-respawn invulnerability window is active. */
  invulnUntil: number; // simulation time (seconds since game start)
  /** True if the player has fired and the bullet is still alive. The
   *  classic single-bullet rule: only one player projectile in flight. */
  bulletAlive: boolean;
};

export type PlayerBullet = {
  x: number;
  y: number;
  /** Set false on collision or off-screen; render skips falsy bullets. */
  alive: boolean;
};

export type Alien = {
  /** Top-left in world coords. Whole formation moves together. */
  x: number;
  y: number;
  /** Row index 0..ALIEN_ROWS-1 (drives color + points). */
  row: number;
  /** Column index 0..ALIEN_COLS-1 (used for column-based fire pick). */
  col: number;
  /** False = killed; render + collision skip. */
  alive: boolean;
};

export type AlienBullet = {
  x: number;
  y: number;
  alive: boolean;
};

/** The mystery saucer. Inactive most of the time; activates on a timer,
 *  crosses the top, and deactivates when it exits the far edge. */
export type Ufo = {
  /** Center-x. Rendered with width UFO_W centered here. */
  x: number;
  y: number;
  active: boolean;
  /** Bonus awarded if shot down this pass. */
  points: number;
  /** Travel direction: -1 entered from the right, +1 from the left. */
  dir: MarchDir;
};

/** A destructible shield. `mask` is a live offscreen canvas that doubles
 *  as the damage state — hits carve pixels out of it. (x, y) is its
 *  top-left in world coords. */
export type Bunker = {
  x: number;
  y: number;
  mask: import("../sprites/bunker").BunkerMask;
};

/** One explosion spark. Pooled — `alive` toggles reuse. */
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds of life remaining. */
  life: number;
  /** Life at spawn — drives the fade-out alpha ramp. */
  maxLife: number;
  color: string;
  alive: boolean;
};

export type GameState = {
  phase: GamePhase;
  /** Seconds elapsed since the current play session started. Resets on
   *  attract → playing transition. Drives invuln window timing + alien
   *  step bookkeeping. */
  time: number;

  /** Player-facing scoreboard values. Mutated by the loop; React reads
   *  via a subscription callback so HUD re-renders only on change. */
  score: number;
  hiScore: number;
  wave: number;
  lives: number;

  player: Player;
  playerBullet: PlayerBullet;

  aliens: Alien[];
  /** Number of aliens with alive=true. Cached so we don't filter() every
   *  tick; updated only when an alien dies. Drives the step-tempo lerp. */
  aliveCount: number;

  /** Formation march state. */
  march: {
    dir: MarchDir;
    /** Seconds until the next step. Decreases each tick; on hit zero
     *  the formation translates and the timer resets to the current
     *  tempo (computed from aliveCount). */
    untilStep: number;
    /** True when the next step should drop+reverse instead of side-step.
     *  Set when any alien reached the wall on the just-completed step. */
    edgeHit: boolean;
    /** Animation frame bit (0|1). Flips on every march step so the swarm
     *  walks in lockstep with its advance — the synced shuffle. */
    frame: 0 | 1;
  };

  alienBullets: AlienBullet[];
  /** Seconds until the next alien fires. */
  untilAlienFire: number;

  ufo: Ufo;
  /** Seconds until the next UFO pass begins. */
  untilUfo: number;
  /** Running count of player shots fired — drives deterministic UFO bonus. */
  shotCount: number;

  /** Seconds left on the "WAVE N" announce between waves. 0 = inactive;
   *  while > 0 the board sits empty (all aliens dead) and the banner shows,
   *  then the next formation drops in. */
  waveFlash: number;

  bunkers: Bunker[];
  particles: Particle[];
};
