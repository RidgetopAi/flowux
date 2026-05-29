import type { ReactNode } from "react";
import "./Playfield.css";

type Props = {
  children?: ReactNode;
};

/* ── Playfield ────────────────────────────────────────────────────────
 * The actual game stage. Vertical-leaning aspect ratio (5:6) gets us
 * close to the original Space Invaders cabinet feel without forcing
 * the projection frame to be portrait-mode. Letterboxing fills the
 * remaining width with cabinet-bezel space.
 *
 * Phase 1: contains the attract-mode <Marquee />.
 * Phase 2+: the engine will mount a <canvas> here for the rAF render.
 *           Inner contents become slotted via children either way.
 */
export function Playfield({ children }: Props) {
  return (
    <div className="playfield-wrap">
      <div className="playfield" aria-label="game playfield">
        <div className="playfield__scanlines" aria-hidden="true" />
        <div className="playfield__inner">{children}</div>
      </div>
    </div>
  );
}
