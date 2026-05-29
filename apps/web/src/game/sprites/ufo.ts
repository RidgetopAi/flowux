import type { PixelSprite } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   SPRITES · UFO
   The mystery saucer that drifts across the top for bonus points. 16×8.
   Two layers so the renderer can two-tone it: the cyan hull plus an amber
   dome cap on top — the mystery-row palette (violet/amber accents) carried
   onto the bonus target. Body drawn first, dome painted over it.
   ──────────────────────────────────────────────────────────────────────── */

/** Saucer hull — drawn in cyan. Underside row reads as landing lights. */
export const UFO_BODY: PixelSprite = {
  w: 16,
  h: 8,
  // prettier-ignore
  data: [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,
    0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,
    0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  ],
};

/** Dome cap — drawn in amber over the hull's crown. Subtle, just the top. */
export const UFO_DOME: PixelSprite = {
  w: 16,
  h: 8,
  // prettier-ignore
  data: [
    0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,
    0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  ],
};
