import "./StatusStrip.css";

type Props = {
  /** Right-aligned phase / build label. */
  phaseLabel: string;
};

/* ── Status strip ─────────────────────────────────────────────────────
 * The bottom chrome rail. Left shows the ESC-to-exit affordance; right
 * shows the build/phase label. Quiet, mono, just enough to anchor the
 * frame visually. Phase 5 may add a coin counter or wave label here.
 */
export function StatusStrip({ phaseLabel }: Props) {
  return (
    <footer className="status-strip" aria-hidden="false">
      <div className="status-strip__left">
        <kbd className="status-strip__kbd">ESC</kbd>
        <span className="status-strip__text">TO EXIT</span>
      </div>
      <div className="status-strip__right">{phaseLabel}</div>
    </footer>
  );
}
