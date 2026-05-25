import os from "node:os";
import path from "node:path";
import type { HarnessMode } from "@flowux/shared";

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
  piMonoBin: string;
  piMonoArgs: string[];
  piMonoCwd: string;
  piMonoUploadDir: string;
  piMonoProvider: string;
  piMonoModel: string;
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
    "--no-extensions",
    "--no-skills",
    "--thinking", piMonoThinking
  ];

  const extra = process.env.FLOWUX_PI_EXTRA_ARGS?.trim();
  if (extra) {
    piMonoArgs.push(...extra.split(/\s+/));
  }

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
    piMonoBin,
    piMonoArgs,
    piMonoCwd,
    piMonoUploadDir,
    piMonoProvider,
    piMonoModel
  };
}

function getDefaultContextWindow(provider: string, model: string) {
  if (provider === "xai" && /^grok-4\.3/i.test(model)) return 1_048_576;
  if (provider === "xai" && /^grok-4/i.test(model)) return 262_144;
  if (provider.startsWith("local-") && /qwen3\.6-35b/i.test(model)) return 140_000;
  return 128_000;
}
