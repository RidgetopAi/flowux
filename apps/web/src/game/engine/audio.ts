/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · AUDIO
   The arcade's voice — every sound synthesized at runtime via Web Audio,
   zero audio files. One AudioContext, one master gain, a single reusable
   white-noise buffer for the explosions. Oscillators + gain envelopes do
   the rest.

   The context starts suspended (browser autoplay policy); resume() must be
   called from inside a user gesture — Game.tsx wires that to the first
   keypress. Every play method is a no-op until the context exists and is
   running, so callers never have to guard.
   ──────────────────────────────────────────────────────────────────────── */

const MASTER_VOL = 0.62;
/** The four descending heartbeat tones, cycled one-per-march-step. */
const MARCH_TONES = [142, 126, 113, 101];

type UfoVoice = {
  osc: OscillatorNode;
  lfo: OscillatorNode;
  gain: GainNode;
};

export type AudioEngine = {
  /** Resume (or lazily create) the context — call from a user gesture. */
  resume: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  shoot: () => void;
  alienExplosion: () => void;
  playerExplosion: () => void;
  ufoExplosion: () => void;
  /** One heartbeat tone; advances the 4-note cycle each call. */
  marchStep: () => void;
  /** Rising arpeggio — the bonus-life "1UP" lift. */
  extraLife: () => void;
  ufoOn: () => void;
  ufoOff: () => void;
  /** Tear everything down (stop the siren, close the context). */
  dispose: () => void;
};

export function createAudioEngine(): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let ufo: UfoVoice | null = null;
  let muted = false;
  let marchIndex = 0;

  /** Lazily build the context graph. Returns null if Web Audio is absent. */
  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;

    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    // A limiter on the bus so we can run the mix loud without harsh
    // clipping when several voices stack (heartbeat + shot + explosion).
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    master.connect(limiter).connect(ctx.destination);

    // One second of white noise, reused for every explosion via a fresh
    // (cheap, fire-and-forget) BufferSource each time.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    return ctx;
  }

  /** True only when we can actually make sound right now. */
  function live(): boolean {
    return ctx !== null && master !== null && ctx.state === "running";
  }

  /* ── Voice builders ──────────────────────────────────────────────────
     Each fires a short, self-cleaning graph: nodes start at `now`, stop at
     a known end, and are GC'd once stopped. No pooling needed at these
     rates. */

  /** A pitched blip with an exponential frequency sweep + AD envelope.
   *  `delay` schedules it that many seconds out — used to sequence the
   *  rising notes of the 1UP chime on the audio clock. */
  function blip(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    attack = 0.004,
    delay = 0,
  ): void {
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A noise burst through a sweeping lowpass — the explosion bed. */
  function noiseBurst(
    fStart: number,
    fEnd: number,
    dur: number,
    peak: number,
  ): void {
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(fStart, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  return {
    resume() {
      const c = ensure();
      if (c && c.state !== "running") void c.resume();
    },

    setMuted(m: boolean) {
      muted = m;
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(m ? 0 : MASTER_VOL, ctx.currentTime, 0.02);
      }
    },
    isMuted: () => muted,

    shoot() {
      if (!live()) return;
      blip("square", 880, 180, 0.16, 0.5);
    },

    alienExplosion() {
      if (!live()) return;
      noiseBurst(4200, 320, 0.2, 0.6);
    },

    playerExplosion() {
      if (!live()) return;
      // Heavier and longer: a noise bed plus a detuned descending growl.
      noiseBurst(2000, 90, 0.6, 0.75);
      blip("sawtooth", 420, 60, 0.55, 0.5);
    },

    ufoExplosion() {
      if (!live()) return;
      noiseBurst(3000, 200, 0.34, 0.62);
      blip("square", 600, 120, 0.34, 0.45);
    },

    marchStep() {
      if (!live()) return;
      const f = MARCH_TONES[marchIndex % MARCH_TONES.length] ?? 120;
      marchIndex += 1;
      // A touch of square in the body would be lost low; triangle reads as
      // the classic thump. Pushed loud — it's the always-on pulse.
      blip("triangle", f, f * 0.92, 0.16, 0.6, 0.006);
    },

    extraLife() {
      if (!live()) return;
      // Three rising square notes (E5 → A5 → E6), each scheduled a beat
      // after the last — the bright "1UP" lift, unmistakably a reward.
      blip("square", 660, 660, 0.09, 0.4, 0.004, 0);
      blip("square", 880, 880, 0.09, 0.4, 0.004, 0.08);
      blip("square", 1320, 1320, 0.15, 0.45, 0.004, 0.16);
    },

    ufoOn() {
      if (!live() || ufo || !ctx || !master) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 620;
      lfo.type = "sine";
      lfo.frequency.value = 8.5;
      lfoGain.gain.value = 70; // vibrato depth (Hz)
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.06);
      osc.connect(gain).connect(master);
      osc.start(t);
      lfo.start(t);
      ufo = { osc, lfo, gain };
    },

    ufoOff() {
      if (!ufo || !ctx) return;
      const { osc, lfo, gain } = ufo;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.0001, t, 0.03);
      osc.stop(t + 0.12);
      lfo.stop(t + 0.12);
      ufo = null;
    },

    dispose() {
      if (ufo && ctx) {
        try {
          ufo.osc.stop();
          ufo.lfo.stop();
        } catch {
          // already stopped — fine
        }
        ufo = null;
      }
      if (ctx) {
        void ctx.close();
        ctx = null;
        master = null;
        noise = null;
      }
    },
  };
}
