import type { AnimSprite } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   SPRITES · ALIENS
   The three iconic Space Invaders archetypes, hand-authored at their
   original pixel footprints. Each has two frames; the second is the
   "legs/arms moved" pose. Frames swap on every march step so the swarm
   walks in lockstep with its advance — the synced shuffle that makes the
   original read as alive rather than merely sliding.

   Footprints differ by archetype (8 / 11 / 12 wide). The renderer centers
   each within the ALIEN_W collision cell, so the AABB stays uniform while
   the silhouettes vary by row — exactly like the arcade.

   Row → archetype mapping (see alienSpriteForRow):
     row 0      → SQUID   (top,    30 pts)
     rows 1,2   → CRAB    (middle, 20 pts)
     rows 3,4   → OCTOPUS (bottom, 10 pts)
   ──────────────────────────────────────────────────────────────────────── */

/** Top row. The small one — two waving feelers, blinking legs. 8×8. */
export const SQUID: AnimSprite = {
  w: 8,
  h: 8,
  frames: [
    // prettier-ignore
    [
      0,0,0,1,1,0,0,0,
      0,0,1,1,1,1,0,0,
      0,1,1,1,1,1,1,0,
      1,1,0,1,1,0,1,1,
      1,1,1,1,1,1,1,1,
      0,1,0,1,1,0,1,0,
      1,0,0,0,0,0,0,1,
      0,1,0,0,0,0,1,0,
    ],
    // prettier-ignore
    [
      0,0,0,1,1,0,0,0,
      0,0,1,1,1,1,0,0,
      0,1,1,1,1,1,1,0,
      1,1,0,1,1,0,1,1,
      1,1,1,1,1,1,1,1,
      0,0,1,0,0,1,0,0,
      0,1,0,1,1,0,1,0,
      1,0,1,0,0,1,0,1,
    ],
  ],
};

/** Middle rows. The crab — pincers up vs pincers down. 11×8. */
export const CRAB: AnimSprite = {
  w: 11,
  h: 8,
  frames: [
    // prettier-ignore
    [
      0,0,1,0,0,0,0,0,1,0,0,
      0,0,0,1,0,0,0,1,0,0,0,
      0,0,1,1,1,1,1,1,1,0,0,
      0,1,1,0,1,1,1,0,1,1,0,
      1,1,1,1,1,1,1,1,1,1,1,
      1,0,1,1,1,1,1,1,1,0,1,
      1,0,1,0,0,0,0,0,1,0,1,
      0,0,0,1,1,0,1,1,0,0,0,
    ],
    // prettier-ignore
    [
      0,0,1,0,0,0,0,0,1,0,0,
      1,0,0,1,0,0,0,1,0,0,1,
      1,0,1,1,1,1,1,1,1,0,1,
      1,1,1,0,1,1,1,0,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,
      0,1,1,1,1,1,1,1,1,1,0,
      0,0,1,0,0,0,0,0,1,0,0,
      0,1,0,0,0,0,0,0,0,1,0,
    ],
  ],
};

/** Bottom rows. The octopus — the big one, tentacles in vs out. 12×8. */
export const OCTOPUS: AnimSprite = {
  w: 12,
  h: 8,
  frames: [
    // prettier-ignore
    [
      0,0,0,0,1,1,1,1,0,0,0,0,
      0,1,1,1,1,1,1,1,1,1,1,0,
      1,1,1,1,1,1,1,1,1,1,1,1,
      1,1,1,0,0,1,1,0,0,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,1,
      0,0,0,1,1,0,0,1,1,0,0,0,
      0,0,1,1,0,1,1,0,1,1,0,0,
      1,1,0,0,0,0,0,0,0,0,1,1,
    ],
    // prettier-ignore
    [
      0,0,0,0,1,1,1,1,0,0,0,0,
      0,1,1,1,1,1,1,1,1,1,1,0,
      1,1,1,1,1,1,1,1,1,1,1,1,
      1,1,1,0,0,1,1,0,0,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,1,
      0,0,1,1,1,0,0,1,1,1,0,0,
      0,1,1,0,0,1,1,0,0,1,1,0,
      0,0,1,1,0,0,0,0,1,1,0,0,
    ],
  ],
};

/** Which archetype a grid row uses. Mirrors the arcade row layout. */
export function alienSpriteForRow(row: number): AnimSprite {
  if (row === 0) return SQUID;
  if (row === 1 || row === 2) return CRAB;
  return OCTOPUS;
}
