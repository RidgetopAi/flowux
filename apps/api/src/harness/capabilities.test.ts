import { describe, expect, test } from "vitest";
import type { FlowuxConfig } from "../config.js";
import { resolveModelCapabilities } from "./capabilities.js";

// Base config covers all required fields; each test overrides only what the
// resolver reads. The pi_mono branch is exercised at the integration level
// (it routes through the global PiTarget registry, not this passed config).
function makeConfig(overrides: Partial<FlowuxConfig>): FlowuxConfig {
  return {
    port: 5174,
    databasePath: ":memory:",
    uploadDir: "./uploads",
    harnessMode: "direct_model",
    modelMode: "mock",
    modelBaseUrl: "http://127.0.0.1:5005",
    modelName: "qwen3.6-35b",
    modelMaxTokens: 2048,
    modelContextWindow: 128000,
    modelSupportsImages: false,
    piMonoBin: "pi",
    piMonoArgs: [],
    piMonoCwd: "/home/ridgetop/projects",
    piMonoUploadDir: "/home/ridgetop/.flowux/uploads",
    piMonoProvider: "xai",
    piMonoModel: "grok-4.3",
    ampBin: "amp",
    ampMode: "smart",
    ampCwd: "/home/ridgetop/projects",
    ampDangerouslyAllowAll: true,
    ampExtraArgs: [],
    ampSupportsImages: false,
    ...overrides
  };
}

describe("resolveModelCapabilities", () => {
  test("direct_model + mock is always text-only (the bug's baseline)", () => {
    const caps = resolveModelCapabilities(makeConfig({ harnessMode: "direct_model", modelMode: "mock" }));
    expect(caps.supportsImages).toBe(false);
    expect(caps.imageDelivery).toBe("none");
    expect(caps.label).toBe("qwen3.6-35b (mock)");
  });

  test("direct_model + llama_cpp without the flag stays text-only", () => {
    const caps = resolveModelCapabilities(
      makeConfig({ harnessMode: "direct_model", modelMode: "llama_cpp", modelSupportsImages: false })
    );
    expect(caps.supportsImages).toBe(false);
    expect(caps.imageDelivery).toBe("none");
  });

  test("direct_model + llama_cpp WITH the flag accepts inline base64 (RESOLVES acf8fe16)", () => {
    const caps = resolveModelCapabilities(
      makeConfig({ harnessMode: "direct_model", modelMode: "llama_cpp", modelSupportsImages: true })
    );
    expect(caps.supportsImages).toBe(true);
    expect(caps.imageDelivery).toBe("inline_base64");
    expect(caps.label).toBe("qwen3.6-35b");
  });

  test("the flag is ignored for mock (mock can never take images)", () => {
    const caps = resolveModelCapabilities(
      makeConfig({ harnessMode: "direct_model", modelMode: "mock", modelSupportsImages: true })
    );
    expect(caps.supportsImages).toBe(false);
    expect(caps.imageDelivery).toBe("none");
  });

  test("ampcode is text-only by default (adapter does not forward images yet)", () => {
    const caps = resolveModelCapabilities(makeConfig({ harnessMode: "ampcode", ampSupportsImages: false }));
    expect(caps.supportsImages).toBe(false);
    expect(caps.imageDelivery).toBe("none");
    expect(caps.label).toBe("amp:smart");
  });

  test("ampcode escape hatch flips delivery on for when amp image delivery lands", () => {
    const caps = resolveModelCapabilities(makeConfig({ harnessMode: "ampcode", ampSupportsImages: true }));
    expect(caps.supportsImages).toBe(true);
    expect(caps.imageDelivery).toBe("inline_base64");
  });
});
