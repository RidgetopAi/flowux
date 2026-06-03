/* ─────────────────────────────────────────────────────────────────────────
   SPRITES · PIXEL DIGITS
   A 3×5 numeric font in the same row-major bit-grid language as the alien
   and ship sprites, so score popups upscale crisp through the pixelated
   canvas instead of smearing like canvas fillText would. Digits only —
   that's all the score readouts need.
   ──────────────────────────────────────────────────────────────────────── */

export const DIGIT_W = 3;
export const DIGIT_H = 5;
/** Horizontal advance between digits — glyph width plus a 1px gap. */
export const DIGIT_ADVANCE = DIGIT_W + 1;

// Indexed 0-9. Each is DIGIT_W × DIGIT_H bits, row-major.
const DIGITS: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1], // 0
  [0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1], // 1
  [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1], // 2
  [1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1], // 3
  [1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1], // 4
  [1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1], // 5
  [1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1], // 6
  [1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], // 7
  [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1], // 8
  [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1], // 9
];

/** Bit grid for a single digit 0-9 (falls back to 0 for out-of-range). */
export function digitGrid(d: number): readonly number[] {
  return DIGITS[d] ?? DIGITS[0]!;
}

/** Pixel width of a number rendered with 1px inter-digit gaps. */
export function numberWidth(value: number): number {
  return String(value).length * DIGIT_ADVANCE - 1;
}
