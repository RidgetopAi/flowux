import { BUNKER_H, BUNKER_W, COLOR_BUNKER } from "../engine/constants";

/* ─────────────────────────────────────────────────────────────────────────
   SPRITES · BUNKER
   The destructible shield — the inverted-U arcade bunker. Unlike the other
   sprites it isn't a static grid blitted each frame: it's a live offscreen
   canvas that IS its own damage state. Hits carve pixels out via a
   destination-out composite, so the mask the player sees is literally the
   collision surface. No parallel damage array to keep in sync.

   Authored as ASCII for legibility — the notch makes a flat 352-int array
   unreadable. Parsed once at module load.
   ──────────────────────────────────────────────────────────────────────── */

// 22 wide × 16 tall. '#' = solid, '.' = open. Rounded crown, square
// shoulders, inverted-U doorway carved into the base.
// prettier-ignore
const SHAPE_ROWS: readonly string[] = [
  "......##########......",
  "....##############....",
  "..##################..",
  ".####################.",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "######################",
  "########......########",
  "#######........#######",
  "######..........######",
  "######..........######",
];

/** A bunker's live damage surface plus the context to mutate it. */
export type BunkerMask = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const TAU = Math.PI * 2;

/** Build a fresh, fully-intact bunker mask. willReadFrequently is set
 *  because collision sampling reads single pixels back every time a
 *  bullet enters the bbox — the hint keeps the canvas on a readback-
 *  friendly backing store instead of round-tripping the GPU. */
export function createBunkerMask(): BunkerMask {
  const canvas = document.createElement("canvas");
  canvas.width = BUNKER_W;
  canvas.height = BUNKER_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("bunker: 2D context unavailable");

  ctx.fillStyle = COLOR_BUNKER;
  for (let y = 0; y < BUNKER_H; y++) {
    const row = SHAPE_ROWS[y];
    if (!row) continue;
    for (let x = 0; x < BUNKER_W; x++) {
      if (row[x] === "#") ctx.fillRect(x, y, 1, 1);
    }
  }
  return { canvas, ctx };
}

/** Is the bunker solid at local (lx, ly)? Out-of-bounds reads as empty. */
export function sampleBunker(mask: BunkerMask, lx: number, ly: number): boolean {
  if (lx < 0 || ly < 0 || lx >= BUNKER_W || ly >= BUNKER_H) return false;
  const px = lx | 0;
  const py = ly | 0;
  return mask.ctx.getImageData(px, py, 1, 1).data[3]! > 0;
}

/** Erode a disc of pixels from the mask at local (lx, ly). destination-out
 *  keeps existing pixels only where the new shape does NOT cover — i.e. it
 *  punches a hole. The disc reads as a scorched bite out of the shield. */
export function carveBunker(
  mask: BunkerMask,
  lx: number,
  ly: number,
  radius: number,
): void {
  const ctx = mask.ctx;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(lx, ly, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}
