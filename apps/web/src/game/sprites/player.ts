import type { PixelSprite } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   SPRITES · PLAYER
   The cannon. Turret on top, body widening into a planted base — the
   classic player silhouette. 14×8 footprint matches PLAYER_W × PLAYER_H
   so the rendered shape and the collision box are one and the same.

   Extracted verbatim from the old render.ts inline grid (Phase 2) so the
   pixel art lives with the other sprites, not buried in the renderer.
   ──────────────────────────────────────────────────────────────────────── */

export const PLAYER: PixelSprite = {
  w: 14,
  h: 8,
  // prettier-ignore
  data: [
    0,0,0,0,0,0,1,1,0,0,0,0,0,0,
    0,0,0,0,0,0,1,1,0,0,0,0,0,0,
    0,0,0,0,0,1,1,1,1,0,0,0,0,0,
    0,0,0,1,1,1,1,1,1,1,1,0,0,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,0,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  ],
};
