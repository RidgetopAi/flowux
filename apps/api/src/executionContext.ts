import type { ExecutionContext } from "@flowux/shared";
import type { FlowuxConfig } from "./config.js";
import { resolveModelCapabilities } from "./harness/capabilities.js";
import { resolveTarget, type PiTarget } from "./harness/targets.js";

/**
 * The runtime context the HUD chip and the model prelude read. When running
 * Pi, it reflects the ACTIVE target (provider/model/transport/cwd) so the HUD
 * updates the moment the user switches targets — not the static startup
 * config. canvasId is threaded for later per-canvas resolution.
 */
export function getExecutionContext(config: FlowuxConfig, canvasId?: string): ExecutionContext {
  const target = config.harnessMode === "pi_mono" ? resolveTarget(canvasId) : undefined;
  const caps = resolveModelCapabilities(config, canvasId);
  return {
    harness: config.harnessMode,
    hostLabel: getExecutionHostLabel(config, target),
    workspaceLabel: getExecutionWorkspaceLabel(config, target),
    filesystemScope: getExecutionWorkspaceLabel(config, target),
    toolCapabilities: getToolCapabilities(config),
    supportsImages: caps.supportsImages,
    imageDelivery: caps.imageDelivery,
    warning:
      config.harnessMode === "pi_mono"
        ? target?.transport === "ssh"
          ? `Tools run on the remote Pi (${target.sshHost}); filesystem access scoped to that machine's Pi workspace.`
          : "Tools run on the local Pi process; filesystem access scoped to the configured Pi workspace."
        : config.harnessMode === "ampcode"
          ? "Amp runs tools on this machine with --dangerously-allow-all; approvals are auto-granted and filesystem access is scoped to the configured Amp workspace."
          : undefined
  };
}

function getExecutionHostLabel(config: FlowuxConfig, target?: PiTarget) {
  if (config.harnessMode === "pi_mono" && target) {
    const where = target.transport === "ssh" ? `remote pi · ${target.sshHost}` : "local pi";
    return `${target.provider}/${target.model} (${where})`;
  }
  if (config.harnessMode === "direct_model") return "local api";
  if (config.harnessMode === "ampcode") return `amp:${config.ampMode} (local)`;
  return config.harnessMode;
}

function getExecutionWorkspaceLabel(config: FlowuxConfig, target?: PiTarget) {
  if (config.harnessMode === "pi_mono" && target) {
    if (target.transport === "ssh") return `${target.sshHost}:${target.cwd || "~"}`;
    return target.cwd;
  }
  if (config.harnessMode === "ampcode") return config.ampCwd || process.cwd();
  return process.cwd();
}

function getToolCapabilities(config: FlowuxConfig) {
  if (config.harnessMode === "pi_mono") return ["filesystem", "shell", "tools"];
  if (config.harnessMode === "ampcode") return ["filesystem", "shell", "tools"];
  if (config.harnessMode === "direct_model") return config.modelMode === "llama_cpp" ? ["model"] : ["mock"];
  return ["tools"];
}
