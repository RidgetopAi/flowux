import { loadConfig } from "../config.js";
import { createDirectModelHarness } from "./directModelAdapter.js";
import { PiMonoHarnessAdapter } from "./piMonoAdapter.js";
import { resolveTarget } from "./targets.js";
import type { HarnessAdapter } from "./types.js";

/**
 * Build the adapter for a prompt. When running Pi, the active PiTarget
 * (resolved per canvas — global for now) decides provider/model/transport.
 * canvasId is threaded through so per-canvas target resolution is a later
 * drop-in with no call-site changes.
 */
export function createHarnessAdapter(canvasId?: string): HarnessAdapter {
  const config = loadConfig();

  if (config.harnessMode === "pi_mono") {
    return new PiMonoHarnessAdapter(resolveTarget(canvasId));
  }

  return createDirectModelHarness();
}

export type { HarnessAdapter, HarnessCapabilities, HarnessTurnInput } from "./types.js";
export { mapPiMonoEvent } from "./piMonoAdapter.js";
export {
  listTargets,
  getTarget,
  getActiveTarget,
  setActiveTarget,
  resolveTarget,
  type PiTarget
} from "./targets.js";
export { pingTarget, type PiPingResult } from "./piMonoAdapter.js";
export {
  checkModelServer,
  startModelServer,
  type ModelServerStatus,
  type ModelServerStartResult
} from "./modelServer.js";
