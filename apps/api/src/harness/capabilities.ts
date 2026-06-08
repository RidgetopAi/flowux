import type { ImageDelivery } from "@flowux/shared";
import type { FlowuxConfig } from "../config.js";
import { resolveTarget } from "./targets.js";

/**
 * The SINGLE source of truth for "what can the active connector's model do
 * with an image this turn?" — consulted by the upload gate, attachment
 * delivery, /api/health and the UI so all four agree instead of each
 * re-deriving capability from a different hardcode.
 *
 * Resolution mirrors createHarnessAdapter(): the answer depends on the active
 * harness mode and (for pi_mono) the resolved PiTarget, so canvasId is threaded
 * through for later per-canvas resolution (global for now).
 */
export interface ModelCapabilities {
  /** Human label for the resolved model, e.g. "xai/grok-4.3" or "amp:smart". */
  label: string;
  /** Whether the model accepts image pixels at all. */
  supportsImages: boolean;
  /** How image bytes reach the model when supportsImages is true. */
  imageDelivery: ImageDelivery;
}

export function resolveModelCapabilities(config: FlowuxConfig, canvasId?: string): ModelCapabilities {
  if (config.harnessMode === "pi_mono") {
    const target = resolveTarget(canvasId);
    return {
      label: `${target.provider}/${target.model}`,
      supportsImages: target.supportsImages,
      // SSH targets run the model on another machine, so bytes are staged as a
      // remote file; a local Pi takes inline base64 over RPC.
      imageDelivery: target.supportsImages
        ? target.transport === "ssh"
          ? "remote_file"
          : "inline_base64"
        : "none"
    };
  }

  if (config.harnessMode === "direct_model") {
    // Mock never accepts images; a real model server (llama.cpp / any
    // OpenAI-compatible /v1) takes inline base64 image_url parts, gated on the
    // FLOWUX_MODEL_SUPPORTS_IMAGES flag (qwen --mmproj, etc.).
    const supportsImages = config.modelMode === "llama_cpp" && config.modelSupportsImages;
    return {
      label: config.modelMode === "mock" ? `${config.modelName} (mock)` : config.modelName,
      supportsImages,
      imageDelivery: supportsImages ? "inline_base64" : "none"
    };
  }

  if (config.harnessMode === "ampcode") {
    // Amp (smart = Claude) is vision-capable, but the ampcode adapter does not
    // forward images yet — claiming support here would silently drop them. Keep
    // it text-only until amp image delivery is wired (its own sub-task), with an
    // env escape hatch for when it lands.
    const supportsImages = config.ampSupportsImages;
    return {
      label: `amp:${config.ampMode}`,
      supportsImages,
      imageDelivery: supportsImages ? "inline_base64" : "none"
    };
  }

  // codex / squire stubs: no delivery path built.
  return { label: config.harnessMode, supportsImages: false, imageDelivery: "none" };
}
