import os from "node:os";
import path from "node:path";
import type { HarnessMode } from "@flowux/shared";

/**
 * Tri-state env boolean: `undefined` when unset/empty so callers can apply
 * their own default (e.g. `envBool("FLOWUX_X") ?? isGrok(...)`). Truthy values
 * are "1" or "true" (case-insensitive); everything else is false.
 */
export function envBool(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  return value === "1" || /^true$/i.test(value);
}

export interface FlowuxConfig {
  port: number;
  databasePath: string;
  uploadDir: string;
  harnessMode: HarnessMode;
  modelMode: "mock" | "llama_cpp";
  modelBaseUrl: string;
  modelName: string;
  modelMaxTokens: number;
  modelContextWindow: number;
  /** direct_model only: does the configured model accept image pixels?
   *  Mock is always false; llama.cpp/OpenAI-compatible reads this flag. */
  modelSupportsImages: boolean;
  piMonoBin: string;
  piMonoArgs: string[];
  piMonoCwd: string;
  piMonoUploadDir: string;
  piMonoProvider: string;
  piMonoModel: string;
  ampBin: string;
  ampMode: string;
  ampCwd: string;
  ampDangerouslyAllowAll: boolean;
  ampEffort?: string;
  ampExtraArgs: string[];
  /** ampcode only: amp (Claude) is vision-capable, but the adapter does not
   *  forward images yet — default false until amp image delivery is wired. */
  ampSupportsImages: boolean;
}

export function loadConfig(): FlowuxConfig {
  const requestedHarnessMode = process.env.FLOWUX_HARNESS_MODE;
  const harnessMode: HarnessMode =
    requestedHarnessMode === "pi_mono" ||
    requestedHarnessMode === "codex" ||
    requestedHarnessMode === "ampcode" ||
    requestedHarnessMode === "squire"
      ? requestedHarnessMode
      : "direct_model";

  const piMonoProvider = process.env.FLOWUX_PI_MONO_PROVIDER ?? "xai";
  const piMonoModel = process.env.FLOWUX_PI_MONO_MODEL ?? process.env.FLOWUX_MODEL_NAME ?? "grok-4.3";
  const piMonoThinking = process.env.FLOWUX_PI_MONO_THINKING ?? "minimal";
  const piMonoBin = process.env.FLOWUX_PI_BIN ?? "pi";
  const piMonoCwd = process.env.FLOWUX_PI_CWD ?? process.cwd();
  const piMonoUploadDir = process.env.FLOWUX_PI_UPLOAD_DIR ?? path.join(os.homedir(), ".flowux", "uploads");

  const piMonoArgs = [
    "--mode", "rpc",
    "--provider", piMonoProvider,
    "--model", piMonoModel,
    "--no-session",
    "--no-context-files",
    "--thinking", piMonoThinking
  ];

  const extra = process.env.FLOWUX_PI_EXTRA_ARGS?.trim();
  if (extra) {
    piMonoArgs.push(...extra.split(/\s+/));
  }

  // Amp (ampcode harness). Mirrors the FLOWUX_PI_* convention. Amp runs as a
  // spawn-per-turn headless agent (`amp -x --stream-json …`), so it needs no
  // provider/model flags — the mode (smart/deep/large/rush) selects the model.
  const ampBin = process.env.FLOWUX_AMP_BIN ?? "amp";
  const ampMode = process.env.FLOWUX_AMP_MODE ?? "smart";
  const ampCwd = process.env.FLOWUX_AMP_CWD ?? process.cwd();
  // ON by default: headless tool-use hangs on approval prompts without it.
  const ampDangerouslyAllowAll = process.env.FLOWUX_AMP_DANGEROUSLY_ALLOW_ALL !== "0";
  const ampEffort = process.env.FLOWUX_AMP_EFFORT?.trim() || undefined;
  const ampExtraArgs = (process.env.FLOWUX_AMP_EXTRA_ARGS?.trim()?.split(/\s+/) ?? []).filter(Boolean);

  return {
    port: Number(process.env.FLOWUX_API_PORT ?? 5174),
    databasePath: process.env.FLOWUX_DB_PATH ?? "./flowux.db",
    uploadDir: process.env.FLOWUX_UPLOAD_DIR ?? "./apps/api/uploads",
    harnessMode,
    modelMode: process.env.FLOWUX_MODEL_MODE === "llama_cpp" ? "llama_cpp" : "mock",
    modelBaseUrl: process.env.FLOWUX_MODEL_BASE_URL ?? "http://127.0.0.1:5005",
    modelName: process.env.FLOWUX_MODEL_NAME ?? "qwen3.6-35b",
    modelMaxTokens: Number(process.env.FLOWUX_MODEL_MAX_TOKENS ?? 2048),
    modelContextWindow: Number(process.env.FLOWUX_MODEL_CONTEXT_WINDOW ?? getDefaultContextWindow(piMonoProvider, piMonoModel)),
    modelSupportsImages: envBool("FLOWUX_MODEL_SUPPORTS_IMAGES") ?? false,
    piMonoBin,
    piMonoArgs,
    piMonoCwd,
    piMonoUploadDir,
    piMonoProvider,
    piMonoModel,
    ampBin,
    ampMode,
    ampCwd,
    ampDangerouslyAllowAll,
    ampEffort,
    ampExtraArgs,
    ampSupportsImages: envBool("FLOWUX_AMP_SUPPORTS_IMAGES") ?? false
  };
}

function getDefaultContextWindow(provider: string, model: string) {
  if (provider === "xai" && /^grok-4\.3/i.test(model)) return 1_048_576;
  if (provider === "xai" && /^grok-4/i.test(model)) return 262_144;
  if (provider.startsWith("local-") && /qwen3\.6-35b/i.test(model)) return 140_000;
  return 128_000;
}
