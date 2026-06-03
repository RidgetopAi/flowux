import { PARTICLE_GRAVITY, PARTICLE_LIFE_S, PARTICLE_POOL_SIZE } from "./constants";
import type { Particle } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · PARTICLES
   A fixed object-pool of explosion sparks. Death events spawn a small
   burst; the pool recycles slots by toggling `alive` instead of churning
   the heap. The point is JUICE, not realism — a handful of sparks that
   arc out and fade carries the hit far better than a physically honest
   debris field would.
   ──────────────────────────────────────────────────────────────────────── */

/** Allocate the pool once. All slots start dead. */
export function createParticlePool(): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: "#fff", alive: false });
  }
  return pool;
}

/** Options that shape the feel of a burst. Defaults give a snappy alien
 *  pop; the player death override is slower and lingers (see callers). */
type BurstOpts = {
  count: number;
  color: string;
  /** Outward speed range, px/s. */
  speedMin?: number;
  speedMax?: number;
  life?: number;
};

/** Spawn a radial burst centered at (x, y), reusing dead pool slots. If
 *  the pool is saturated the extra particles are simply dropped — at our
 *  burst sizes and lifespans the pool never realistically runs dry. */
export function spawnBurst(
  pool: Particle[],
  x: number,
  y: number,
  opts: BurstOpts,
): void {
  const speedMin = opts.speedMin ?? 30;
  const speedMax = opts.speedMax ?? 90;
  const life = opts.life ?? PARTICLE_LIFE_S;

  let spawned = 0;
  for (const p of pool) {
    if (spawned >= opts.count) break;
    if (p.alive) continue;

    // Even angular spread with jitter so bursts don't look like spokes.
    const angle = (spawned / opts.count) * Math.PI * 2 + Math.random() * 0.8;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = life;
    p.maxLife = life;
    p.color = opts.color;
    p.alive = true;
    spawned += 1;
  }
}

/** Advance every live particle. Gravity pulls the arc downward; a slot
 *  dies when its life runs out. */
export function stepParticles(pool: Particle[], dt: number): void {
  for (const p of pool) {
    if (!p.alive) continue;
    p.vy += PARTICLE_GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) p.alive = false;
  }
}
