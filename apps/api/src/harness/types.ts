import type { ContextMessage, FlowuxTurnEvent, HarnessMode, ModelProvider } from "@flowux/shared";

export interface HarnessTurnInput {
  messages: ContextMessage[];
  prompt: string;
  canvasId: string;
  mrpId: string;
  modelRunId: string;
}

export interface HarnessCapabilities {
  thinking: boolean;
  toolCalls: boolean;
  toolResults: boolean;
  files: boolean;
  artifacts: boolean;
  tokenUsage: boolean;
  rawEvents: boolean;
}

export interface HarnessAdapter {
  mode: HarnessMode;
  provider: ModelProvider;
  model: string;
  capabilities: HarnessCapabilities;
  generate(input: HarnessTurnInput): AsyncGenerator<FlowuxTurnEvent>;
}
