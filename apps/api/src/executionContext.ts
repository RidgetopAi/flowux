import type { ExecutionContext } from "@flowux/shared";
import type { FlowuxConfig } from "./config.js";

export function getExecutionContext(config: FlowuxConfig): ExecutionContext {
  return {
    harness: config.harnessMode,
    hostLabel: getExecutionHostLabel(config),
    workspaceLabel: getExecutionWorkspaceLabel(config),
    filesystemScope: getExecutionWorkspaceLabel(config),
    toolCapabilities: getToolCapabilities(config),
    warning:
      config.harnessMode === "pi_mono"
        ? "Tools run on the configured remote host, not necessarily on the Flowux UI machine."
        : undefined
  };
}

function getExecutionHostLabel(config: FlowuxConfig) {
  if (config.harnessMode === "pi_mono") return config.piMonoRemoteHost;
  if (config.harnessMode === "direct_model") return "local api";
  return config.harnessMode;
}

function getExecutionWorkspaceLabel(config: FlowuxConfig) {
  if (config.harnessMode === "pi_mono") return config.piMonoRemoteCwd;
  return process.cwd();
}

function getToolCapabilities(config: FlowuxConfig) {
  if (config.harnessMode === "pi_mono") return ["filesystem", "shell", "tools"];
  if (config.harnessMode === "direct_model") return config.modelMode === "llama_cpp" ? ["model"] : ["mock"];
  return ["tools"];
}
