import type { ContextMessage, ModelProvider } from "@flowux/shared";
import { loadConfig } from "../config.js";

export interface GenerateInput {
  messages: ContextMessage[];
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type ModelStreamEvent =
  | { type: "response_delta"; text: string; raw?: unknown }
  | { type: "thinking_delta"; text: string; raw?: unknown }
  | { type: "usage"; usage: TokenUsage; raw?: unknown }
  | { type: "done"; finishReason?: string; raw?: unknown };

export interface ModelAdapter {
  provider: ModelProvider;
  model: string;
  generate(input: GenerateInput): AsyncGenerator<ModelStreamEvent>;
}

export function createModelAdapter(): ModelAdapter {
  const config = loadConfig();
  if (config.modelMode === "llama_cpp") {
    return new LlamaCppAdapter(config.modelBaseUrl, config.modelName, config.modelMaxTokens);
  }
  return new MockAdapter(config.modelName);
}

class MockAdapter implements ModelAdapter {
  provider: ModelProvider = "mock";

  constructor(public model: string) {}

  async *generate(input: GenerateInput): AsyncGenerator<ModelStreamEvent> {
    const latest = input.messages.at(-1)?.content ?? "";
    const text = [
      "Mock Flowux response.",
      "This confirms the prompt-to-MRP path, persistence, and context assembly are wired.",
      `Latest prompt: ${latest}`
    ].join("\n\n");

    for (const token of text.split(/(\s+)/)) {
      yield { type: "response_delta", text: token };
    }
    yield { type: "done", finishReason: "stop" };
  }
}

class LlamaCppAdapter implements ModelAdapter {
  provider: ModelProvider = "llama_cpp";

  constructor(
    private readonly baseUrl: string,
    public model: string,
    private readonly maxTokens: number
  ) {}

  async *generate(input: GenerateInput): AsyncGenerator<ModelStreamEvent> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: input.messages.map(({ role, content }) => ({ role, content })),
        max_tokens: this.maxTokens,
        stream: true,
        stream_options: { include_usage: true }
      })
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`llama.cpp request failed: ${response.status} ${body}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let latestUsage: TokenUsage | undefined;
    let finishReason: string | undefined;

    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          if (latestUsage) yield { type: "usage", usage: latestUsage };
          yield { type: "done", finishReason };
          return;
        }
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string | null;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        const choice = parsed.choices?.[0];
        const content = choice?.delta?.content;
        const reasoningContent = choice?.delta?.reasoning_content;
        if (reasoningContent) yield { type: "thinking_delta", text: reasoningContent, raw: parsed };
        if (content) yield { type: "response_delta", text: content, raw: parsed };
        if (parsed.usage) {
          latestUsage = {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
            totalTokens: parsed.usage.total_tokens
          };
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    }

    if (latestUsage) yield { type: "usage", usage: latestUsage };
    yield { type: "done", finishReason };
  }
}
