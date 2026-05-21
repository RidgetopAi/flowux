import { describe, expect, it } from "vitest";
import { buildContextMessages } from "./context.js";
import type { Mrp } from "./types.js";

const baseMrp = (id: string, sequence: number): Mrp => ({
  id,
  canvasId: "canvas-1",
  sequence,
  userPrompt: `prompt ${sequence}`,
  assistantResponse: `response ${sequence}`,
  status: "complete",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z"
});

describe("buildContextMessages", () => {
  it("orders selected MRPs by canonical sequence, not selection order", () => {
    const messages = buildContextMessages({
      mrps: [baseMrp("a", 3), baseMrp("b", 1), baseMrp("c", 2)],
      selectedMrpIds: ["a", "c", "b"],
      currentPrompt: "next"
    });

    expect(messages.map((message) => message.content)).toEqual([
      "prompt 1",
      "response 1",
      "prompt 2",
      "response 2",
      "prompt 3",
      "response 3",
      "next"
    ]);
  });
});

