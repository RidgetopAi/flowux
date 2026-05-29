import "./HudBar.css";

type Props = {
  score: number;
  hiScore: number;
  wave: number;
  lives: number;
};

/* ── HUD bar ──────────────────────────────────────────────────────────
 * Top-of-frame tactical readout. Four columns: SCORE / HI-SCORE / WAVE /
 * LIVES. Each column is a uppercase mono micro-label stacked over a
 * JetBrains-Mono 700 value with phosphor glow.
 *
 * Phase 1 receives static placeholder values from <InvadersStage />.
 * Phase 2+ will wire these to game state.
 */
export function HudBar({ score, hiScore, wave, lives }: Props) {
  return (
    <header className="hud-bar" role="status" aria-label="game status">
      <HudColumn label="SCORE" value={pad(score, 4)} tone="cyan" />
      <HudColumn label="HI-SCORE" value={pad(hiScore, 4)} tone="amber" />
      <HudColumn label="WAVE" value={pad(wave, 2)} tone="cyan" />
      <HudColumn
        label="LIVES"
        value={<LivesRow count={lives} />}
        tone="cyan"
      />
    </header>
  );
}

function HudColumn({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: "cyan" | "amber";
}) {
  return (
    <div className={`hud-col hud-col--${tone}`}>
      <div className="hud-col__label">{label}</div>
      <div className="hud-col__value">{value}</div>
    </div>
  );
}

/* Pad an integer with leading zeros to a fixed digit width. Classic
 * arcade SCORE field — the leading zeros are part of the genre. */
function pad(n: number, width: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, "0");
}

/* Lives indicator — a row of small ship glyphs. Phase 1 uses a tiny
 * inline SVG; Phase 3 will swap to the real pixel-grid sprite (scaled
 * down) so the lives icon matches the in-game ship exactly. */
function LivesRow({ count }: { count: number }) {
  const ships = Math.max(0, Math.min(5, count));
  return (
    <div className="hud-lives" aria-label={`${count} lives remaining`}>
      {Array.from({ length: ships }, (_, i) => (
        <ShipGlyph key={i} />
      ))}
    </div>
  );
}

function ShipGlyph() {
  // 16x10 viewbox — chunky '80s player ship outline. Token-driven fill
  // (currentColor) so the LIVES column tone drives the color.
  return (
    <svg
      className="hud-ship"
      viewBox="0 0 16 10"
      width="22"
      height="14"
      aria-hidden="true"
    >
      <path
        d="M7 0 H9 V2 H10 V4 H13 V5 H15 V8 H16 V10 H0 V8 H1 V5 H3 V4 H6 V2 H7 Z"
        fill="currentColor"
      />
    </svg>
  );
}
