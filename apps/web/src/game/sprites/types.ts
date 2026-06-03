/* ─────────────────────────────────────────────────────────────────────────
   SPRITES · SHARED SHAPE
   A sprite is a row-major 0/1 pixel grid. The renderer fills 1-cells as
   1×1 canvas rects, so every sprite here is authored at its true pixel
   resolution — no scaling baked in. Scaling is the canvas' job
   (imageRendering: pixelated on upscale).
   ──────────────────────────────────────────────────────────────────────── */

/** A single static pixel grid. `data` length must equal w*h. */
export type PixelSprite = {
  w: number;
  h: number;
  /** Row-major. 1 = lit pixel, 0 = transparent. */
  data: readonly number[];
};

/** A 2-frame animated sprite — both frames share footprint. Frame swap is
 *  driven by the formation's march step (see GameState.march.frame) so the
 *  whole grid shuffles in lockstep, the classic Space Invaders walk. */
export type AnimSprite = {
  w: number;
  h: number;
  frames: readonly [readonly number[], readonly number[]];
};
