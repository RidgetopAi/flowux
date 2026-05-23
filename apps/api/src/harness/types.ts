import type { ContextMessage, ExecutionContext, FlowuxTurnEvent, HarnessMode, ModelProvider } from "@flowux/shared";
import type { HarnessImageInput } from "../services/attachmentDelivery.js";

export interface HarnessTurnInput {
  messages: ContextMessage[];
  prompt: string;
  canvasId: string;
  mrpId: string;
  modelRunId: string;
  executionContext?: ExecutionContext;
  images?: HarnessImageInput[];
  signal?: AbortSignal;
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
