import { useMemo, type CSSProperties } from "react";
import "./BrailleBand.css";

type Tone = "cyan" | "violet" | "amber" | "muted";

type Props = {
  /** Number of Braille glyphs to render. Default ~64. */
  length?: number;
  /** 0–1, controls how many of the 8 cell dots are set per glyph. */
  density?: number;
  /** Color tone. */
  tone?: Tone;
  /** Seed for deterministic generation (same seed = same pattern). */
  seed?: number;
  /** Render-time className passthrough. */
  className?: string;
  style?: CSSProperties;
};

const TONE_COLOR: Record<Tone, string> = {
  cyan: "var(--cyan-dim)",
  violet: "var(--violet-dim)",
  amber: "var(--amber-dim)",
  muted: "var(--muted)",
};

const TONE_GLOW: Record<Tone, string> = {
  cyan: "var(--glow-cyan-sm)",
  violet: "var(--glow-violet-sm)",
  amber: "var(--glow-amber-sm)",
  muted: "none",
};

/**
 * Mulberry32 — tiny deterministic PRNG. We don't need crypto, we need
 * the same band on every render given the same seed.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a Braille glyph from 8 dot bits. Unicode block 0x2800 + bitfield.
 * Bits map (per Unicode spec): 1=top-left, 2=mid-left, 4=bot-left, 8=top-right,
 * 16=mid-right, 32=bot-right, 64=bottom-left-extra, 128=bottom-right-extra.
 */
function braille(bits: number): string {
  return String.fromCharCode(0x2800 + (bits & 0xff));
}

/**
 * Renders a horizontal band of Unicode Braille glyphs. Used as section
 * dividers, surface texture, or loading skins. Deterministic via seed.
 *
 * The literal-Braille interpretation of the locked visual style — fits
 * the name "FlowUX" by giving the chrome a tactile, encoded feel.
 */
export function BrailleBand({
  length = 64,
  density = 0.5,
  tone = "muted",
  seed = 1,
  className,
  style,
}: Props) {
  const text = useMemo(() => {
    const rand = rng(seed);
    let out = "";
    for (let i = 0; i < length; i++) {
      let bits = 0;
      for (let b = 0; b < 8; b++) {
        if (rand() < density) bits |= 1 << b;
      }
      out += braille(bits);
    }
    return out;
  }, [length, density, seed]);

  const composedStyle: CSSProperties = {
    color: TONE_COLOR[tone],
    textShadow: TONE_GLOW[tone],
    ...style,
  };

  return (
    <span
      className={["braille-band", className].filter(Boolean).join(" ")}
      style={composedStyle}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}
