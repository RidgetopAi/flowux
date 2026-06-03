import "./Marquee.css";

/* ── Marquee ──────────────────────────────────────────────────────────
 * Phase 1 attract-mode placeholder. Two centered messages, the upper
 * one pulses, the lower is steady muted. When Phase 2 wires the engine
 * this component will only render in the "attract" / "game over"
 * states, suppressed during active play.
 */
export function Marquee() {
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__primary">PRESS START</div>
      <div className="marquee__secondary">INSERT 1 COIN</div>
    </div>
  );
}
