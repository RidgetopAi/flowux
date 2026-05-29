import { loadConfig, type FlowuxConfig } from "../config.js";

/**
 * A Pi "target" is a fully-resolved description of WHICH Pi the API spawns a
 * prompt against and HOW. It replaces the old startup-env-baked
 * provider/model so the UI can switch between, e.g., a LOCAL Pi (xai/grok) and
 * a REMOTE Pi on another machine (over SSH) running a local model.
 *
 * Targets are first-class objects keyed by a stable `id` and live in a small
 * in-process registry. Everything that needs to know "what model are we
 * talking to" goes through resolveTarget(canvasId?) — a single indirection.
 *
 * SCOPE TODAY: one GLOBAL active target (resolveTarget ignores canvasId).
 * SCOPE LATER (per-canvas): resolveTarget reads canvasThreads.modelConfigId →
 * target id, falling back to the global default. Because every call site
 * already routes through resolveTarget(canvasId), that upgrade is a drop-in —
 * no call sites change.
 */
export interface PiTarget {
  /** Stable identifier, e.g. "local-grok", "desktop-local". */
  id: string;
  /** Human label for the UI, e.g. "Local · grok-4.3". */
  label: string;
  /** local = spawn pi here; ssh = spawn `ssh <host> -- pi …`. */
  transport: "local" | "ssh";
  /** SSH host (ssh transport only), e.g. "ridgetop-desktop". */
  sshHost?: string;
  /** Pi binary name/path (resolved on the TARGET machine). */
  bin: string;
  /** Pi `--provider` flag, e.g. "xai" | "ollama". */
  provider: string;
  /** Pi `--model` flag. */
  model: string;
  /** Pi `--thinking` flag. */
  thinking: string;
  /** Working dir on the target machine. Empty = don't cd (use login default). */
  cwd: string;
  /** Token budget sizing for this target's model. */
  contextWindow: number;
  /** Max output tokens for this target's model. */
  maxOutputTokens: number;
  /** Whether this target's model accepts image pixels (grok yes; local no). */
  supportsImages: boolean;
}

interface TargetsState {
  targets: PiTarget[];
  activeId: string;
}

let state: TargetsState | null = null;

/** Build the initial registry from config + remote env. Called once, lazily. */
function buildInitialState(config: FlowuxConfig): TargetsState {
  const local: PiTarget = {
    id: "local-grok",
    label: `Local · ${config.piMonoModel}`,
    transport: "local",
    bin: config.piMonoBin,
    provider: config.piMonoProvider,
    model: config.piMonoModel,
    thinking: process.env.FLOWUX_PI_MONO_THINKING ?? "minimal",
    cwd: config.piMonoCwd,
    contextWindow: contextWindowFor(config.piMonoProvider, config.piMonoModel),
    maxOutputTokens: config.modelMaxTokens,
    supportsImages: isGrok(config.piMonoProvider, config.piMonoModel)
  };

  // Remote desktop target. Flags are PROVISIONAL until verified against the
  // desktop's pi config (Phase 2) — overridable via FLOWUX_PI_REMOTE_*.
  const remoteHost = process.env.FLOWUX_PI_REMOTE_HOST ?? "ridgetop-desktop";
  const remoteProvider = process.env.FLOWUX_PI_REMOTE_PROVIDER ?? "ollama";
  // Independent of the local script's FLOWUX_MODEL_NAME (which may be grok).
  // Provisional until verified against the desktop's pi config (Phase 2).
  const remoteModel = process.env.FLOWUX_PI_REMOTE_MODEL ?? "qwen3.6-35b";
  const remote: PiTarget = {
    id: "desktop-local",
    label: `${remoteHost} · ${remoteModel}`,
    transport: "ssh",
    sshHost: remoteHost,
    bin: process.env.FLOWUX_PI_REMOTE_BIN ?? "pi",
    provider: remoteProvider,
    model: remoteModel,
    thinking: process.env.FLOWUX_PI_REMOTE_THINKING ?? "minimal",
    cwd: process.env.FLOWUX_PI_REMOTE_CWD ?? "",
    contextWindow: Number(
      process.env.FLOWUX_PI_REMOTE_CONTEXT_WINDOW ?? contextWindowFor(remoteProvider, remoteModel)
    ),
    maxOutputTokens: Number(process.env.FLOWUX_PI_REMOTE_MAX_TOKENS ?? config.modelMaxTokens),
    supportsImages: isGrok(remoteProvider, remoteModel)
  };

  const activeId = process.env.FLOWUX_PI_ACTIVE_TARGET ?? local.id;
  const targets = [local, remote];
  return {
    targets,
    activeId: targets.some((t) => t.id === activeId) ? activeId : local.id
  };
}

function ensureState(): TargetsState {
  if (!state) state = buildInitialState(loadConfig());
  return state;
}

/** All known targets + the active id (for the UI selector). */
export function listTargets(): { targets: PiTarget[]; activeTargetId: string } {
  const s = ensureState();
  return { targets: s.targets, activeTargetId: s.activeId };
}

export function getTarget(id: string): PiTarget | undefined {
  return ensureState().targets.find((t) => t.id === id);
}

export function getActiveTarget(): PiTarget {
  const s = ensureState();
  return s.targets.find((t) => t.id === s.activeId) ?? s.targets[0]!;
}

/** Set the GLOBAL active target. Returns the now-active target, or undefined
 *  if the id is unknown. */
export function setActiveTarget(id: string): PiTarget | undefined {
  const s = ensureState();
  const target = s.targets.find((t) => t.id === id);
  if (!target) return undefined;
  s.activeId = id;
  return target;
}

/**
 * The single indirection. canvasId is accepted NOW (so call sites are already
 * correct) but ignored — global active target. Per-canvas resolution slots in
 * here later without touching callers.
 */
export function resolveTarget(_canvasId?: string): PiTarget {
  return getActiveTarget();
}

function isGrok(provider: string, model: string): boolean {
  return provider === "xai" && /grok/i.test(model);
}

function contextWindowFor(provider: string, model: string): number {
  if (provider === "xai" && /^grok-4\.3/i.test(model)) return 1_048_576;
  if (provider === "xai" && /^grok-4/i.test(model)) return 262_144;
  if (/qwen3\.6-35b/i.test(model)) return 140_000;
  return 128_000;
}
