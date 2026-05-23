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
  piMonoRemoteHost: string;
  piMonoRemoteCwd: string;
  piMonoRemoteUploadDir: string;
  piMonoCommand: string;
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

  const piMonoProvider = process.env.FLOWUX_PI_MONO_PROVIDER ?? "local-qwen";
  const piMonoModel = process.env.FLOWUX_PI_MONO_MODEL ?? process.env.FLOWUX_MODEL_NAME ?? "qwen3.6-35b";
  const piMonoThinking = process.env.FLOWUX_PI_MONO_THINKING ?? "minimal";
  const piMonoOffline = process.env.FLOWUX_PI_MONO_OFFLINE ?? (piMonoProvider.startsWith("local-") ? "1" : "0");
  const piMonoCommand =
    process.env.FLOWUX_PI_MONO_COMMAND ??
    [
      "PATH=/home/ridgetop/.local/flowux/node-v22.22.3-linux-x64/bin:$PATH",
      piMonoOffline === "1" ? "PI_OFFLINE=1" : undefined,
      "node /home/ridgetop/projects/pi-mono/packages/coding-agent/dist/cli.js",
      "--mode rpc",
      `--provider ${shellArg(piMonoProvider)}`,
      `--model ${shellArg(piMonoModel)}`,
      "--no-session",
      "--no-context-files",
      `--thinking ${shellArg(piMonoThinking)}`
    ]
      .filter(Boolean)
      .join(" ");

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
    piMonoRemoteHost: process.env.FLOWUX_PI_MONO_REMOTE_HOST ?? "ridgetop@ridgetop-desktop",
    piMonoRemoteCwd: process.env.FLOWUX_PI_MONO_REMOTE_CWD ?? "/home/ridgetop/projects",
    piMonoRemoteUploadDir: process.env.FLOWUX_PI_MONO_REMOTE_UPLOAD_DIR ?? "/home/ridgetop/.flowux/uploads",
    piMonoCommand,
    piMonoProvider,
    piMonoModel
  };
}

function getDefaultContextWindow(provider: string, model: string) {
  if (provider === "xai" && /^grok-4\.3/i.test(model)) return 131_072;
  if (provider.startsWith("local-") && /qwen3\.6-35b/i.test(model)) return 140_000;
  return 128_000;
}

function shellArg(value: string) {
  if (/^[A-Za-z0-9._:/@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
