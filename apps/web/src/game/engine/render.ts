import { alienSpriteForRow } from "../sprites/aliens";
import { DIGIT_ADVANCE, DIGIT_H, DIGIT_W, digitGrid, numberWidth } from "../sprites/digits";
import { PLAYER } from "../sprites/player";
import type { PixelSprite } from "../sprites/types";
import { UFO_BODY, UFO_DOME } from "../sprites/ufo";
import {
  ALIEN_W,
  BULLET_H,
  BULLET_W,
  COLOR_ALIEN_BULLET,
  COLOR_ALIEN_ROW,
  COLOR_BULLET,
  COLOR_BUNKER,
  COLOR_PLAYER,
  COLOR_POPUP,
  COLOR_UFO_BODY,
  COLOR_UFO_DOME,
  PLAYER_H,
  PLAYER_W,
  PLAYFIELD_H,
  PLAYFIELD_W,
  UFO_W,
  UFO_Y,
} from "./constants";
import type { GameState } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · RENDER
   Phase 3 renderer — hand-authored pixel sprites with whole-sprite phosphor
   halos, live destructible bunkers, the mystery saucer, and additive-blend
   explosion sparks.

   All draws use integer coords. The canvas is configured pixel-perfect
   (imageRendering: pixelated) so we never blur on upscale. The glow is the
   one deliberate exception — shadowBlur is applied PER SPRITE, not per
   pixel: a single Path2D fill casts one composited halo for the whole
   shape, so 55 aliens cost 55 shadow passes, not thousands.
   ──────────────────────────────────────────────────────────────────────── */

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Clear with a near-black wash. The Playfield CSS already gives us a
  // CRT vignette; the canvas itself is just black + glow.
  ctx.fillStyle = "#020303";
  ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);

  // Game-over freezes to black — the DOM "GAME OVER" overlay owns that
  // screen. Attract now renders the live board: the self-playing demo
  // dances behind the PRESS START prompt. So only game-over skips drawing.
  if (state.phase === "gameOver") return;

  // ── UFO ─────────────────────────────────────────────────────────────
  if (state.ufo.active) {
    const ux = (state.ufo.x - UFO_W / 2) | 0;
    drawSprite(ctx, UFO_BODY, ux, UFO_Y, COLOR_UFO_BODY, 3);
    drawSprite(ctx, UFO_DOME, ux, UFO_Y, COLOR_UFO_DOME, 2);
  }

  // ── Aliens ─────────────────────────────────────────────────────────
  // Sprite footprints vary by archetype (8/11/12 wide) but the collision
  // cell is uniform ALIEN_W — center each sprite in its cell.
  for (const a of state.aliens) {
    if (!a.alive) continue;
    const sprite = alienSpriteForRow(a.row);
    const grid = sprite.frames[state.march.frame];
    const offsetX = ((ALIEN_W - sprite.w) / 2) | 0;
    const color = COLOR_ALIEN_ROW[a.row] ?? "#a8fff1";
    drawGrid(ctx, grid, sprite.w, sprite.h, (a.x | 0) + offsetX, a.y | 0, color, 2);
  }

  // ── Bunkers ─────────────────────────────────────────────────────────
  // The mask canvas already holds the current damage state — just blit it,
  // with a soft halo so the shields glow like everything else.
  for (const bk of state.bunkers) {
    ctx.save();
    ctx.shadowColor = COLOR_BUNKER;
    ctx.shadowBlur = 2;
    ctx.drawImage(bk.mask.canvas, bk.x, bk.y);
    ctx.restore();
  }

  // ── Player ─────────────────────────────────────────────────────────
  // Blink player during invuln window — only render every other 0.1s
  // tick. Reads as "i'm respawning, don't shoot me."
  const inInvuln = state.time < state.player.invulnUntil;
  const blinkOn = !inInvuln || (Math.floor(state.time * 12) & 1) === 0;
  if (blinkOn) {
    const px = (state.player.x - PLAYER_W / 2) | 0;
    const py = (state.player.y - PLAYER_H / 2) | 0;
    drawSprite(ctx, PLAYER, px, py, COLOR_PLAYER, 4);
  }

  // ── Player bullet ──────────────────────────────────────────────────
  if (state.playerBullet.alive) {
    drawGlowRect(
      ctx,
      (state.playerBullet.x - BULLET_W / 2) | 0,
      state.playerBullet.y | 0,
      BULLET_W,
      BULLET_H,
      COLOR_BULLET,
      3,
    );
  }

  // ── Alien bullets ──────────────────────────────────────────────────
  for (const b of state.alienBullets) {
    if (!b.alive) continue;
    drawGlowRect(
      ctx,
      (b.x - BULLET_W / 2) | 0,
      b.y | 0,
      BULLET_W,
      BULLET_H,
      COLOR_ALIEN_BULLET,
      2,
    );
  }

  // ── Particles ──────────────────────────────────────────────────────
  // Additive blend so overlapping sparks bloom hot, fading with life.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of state.particles) {
    if (!p.alive) continue;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 2;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
  }
  ctx.restore();

  // ── Score popups ───────────────────────────────────────────────────
  // Drawn last so floating points sit on top of the debris they rose from.
  for (const sp of state.scorePopups) {
    if (!sp.alive) continue;
    const alpha = Math.max(0, Math.min(1, sp.life / sp.maxLife));
    drawNumber(ctx, sp.value, sp.x, sp.y, COLOR_POPUP, alpha);
  }
}

/* Draw a non-negative integer centered horizontally on `cx`, top at `y`,
 * using the 3×5 pixel digit font. One Path2D + one shadow pass for the
 * whole number, faded by `alpha` for the rise-and-vanish popups. */
function drawNumber(
  ctx: CanvasRenderingContext2D,
  value: number,
  cx: number,
  y: number,
  color: string,
  alpha: number,
): void {
  const str = String(value);
  let x = Math.round(cx - numberWidth(value) / 2);
  const top = y | 0;
  const path = new Path2D();
  for (let i = 0; i < str.length; i++) {
    const grid = digitGrid(str.charCodeAt(i) - 48);
    for (let py = 0; py < DIGIT_H; py++) {
      for (let px = 0; px < DIGIT_W; px++) {
        if (grid[py * DIGIT_W + px]) path.rect(x + px, top + py, 1, 1);
      }
    }
    x += DIGIT_ADVANCE;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = 2;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}

/* Paint a rectangle with a phosphor halo. Shadow is applied per draw —
 * cheap enough for the handful of bullets on screen. */
function drawGlowRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  blur: number,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/* Blit a static pixel sprite at (x, y). */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: PixelSprite,
  x: number,
  y: number,
  color: string,
  blur: number,
): void {
  drawGrid(ctx, sprite.data, sprite.w, sprite.h, x, y, color, blur);
}

/* Fill the lit cells of a 0/1 grid as 1×1 rects, gathered into ONE Path2D
 * so the phosphor halo is a single composited shadow for the whole shape
 * rather than one shadow per pixel. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: readonly number[],
  w: number,
  h: number,
  x: number,
  y: number,
  color: string,
  blur: number,
): void {
  const path = new Path2D();
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (grid[py * w + px]) path.rect(x + px, y + py, 1, 1);
    }
  }
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}
