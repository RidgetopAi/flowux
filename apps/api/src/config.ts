export interface FlowuxConfig {
  port: number;
  databasePath: string;
  modelMode: "mock" | "llama_cpp";
  modelBaseUrl: string;
  modelName: string;
  modelMaxTokens: number;
}

export function loadConfig(): FlowuxConfig {
  return {
    port: Number(process.env.FLOWUX_API_PORT ?? 5174),
    databasePath: process.env.FLOWUX_DB_PATH ?? "./flowux.db",
    modelMode: process.env.FLOWUX_MODEL_MODE === "llama_cpp" ? "llama_cpp" : "mock",
    modelBaseUrl: process.env.FLOWUX_MODEL_BASE_URL ?? "http://127.0.0.1:5005",
    modelName: process.env.FLOWUX_MODEL_NAME ?? "qwen3.6-35b",
    modelMaxTokens: Number(process.env.FLOWUX_MODEL_MAX_TOKENS ?? 2048)
  };
}
