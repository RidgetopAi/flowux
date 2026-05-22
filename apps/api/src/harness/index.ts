import { loadConfig } from "../config.js";
import { createDirectModelHarness } from "./directModelAdapter.js";
import { PiMonoHarnessAdapter } from "./piMonoAdapter.js";
import type { HarnessAdapter } from "./types.js";

export function createHarnessAdapter(): HarnessAdapter {
  const config = loadConfig();

  if (config.harnessMode === "pi_mono") {
    return new PiMonoHarnessAdapter(config);
  }

  return createDirectModelHarness();
}

export type { HarnessAdapter, HarnessCapabilities, HarnessTurnInput } from "./types.js";
export { mapPiMonoEvent } from "./piMonoAdapter.js";
