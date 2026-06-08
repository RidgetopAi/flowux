import type { FlowuxTurnEvent } from "@flowux/shared";
import { createModelAdapter } from "../model/adapter.js";
import type { HarnessAdapter, HarnessTurnInput } from "./types.js";

export function createDirectModelHarness(): HarnessAdapter {
  const modelAdapter = createModelAdapter();

  return {
    mode: "direct_model",
    provider: modelAdapter.provider,
    model: modelAdapter.model,
    capabilities: {
      thinking: true,
      toolCalls: false,
      toolResults: false,
      files: false,
      artifacts: false,
      tokenUsage: true,
      rawEvents: true
    },
    async *generate(input: HarnessTurnInput): AsyncGenerator<FlowuxTurnEvent> {
      yield { type: "turn_started" };

      // Forward inline images so a vision-capable model server (llama.cpp
      // --mmproj / any OpenAI /v1) receives them. The gate already guarantees
      // images only arrive here when the model supports them.
      for await (const event of modelAdapter.generate({ messages: input.messages, images: input.images })) {
        yield event;
      }
    }
  };
}
