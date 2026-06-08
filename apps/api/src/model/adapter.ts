import type { ContextMessage, ModelProvider } from "@flowux/shared";
import { loadConfig } from "../config.js";

/** Minimal image shape the model layer needs (structurally compatible with
 *  the harness HarnessImageInput, sans its `type` tag). */
export interface ImageInput {
  data: string;
  mimeType: string;
}

export interface GenerateInput {
  messages: ContextMessage[];
  images?: ImageInput[];
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: ContextMessage["role"];
  content: string | ChatContentPart[];
}

/**
 * Build the OpenAI-/llama.cpp-compatible chat messages. With no images the
 * content stays a plain string; with images they are attached to the LAST user
 * message as multimodal content parts (text first, then inline base64
 * data-URIs) — the shape llama.cpp --mmproj and any OpenAI /v1 vision model
 * expect.
 */
export function buildChatMessages(messages: ContextMessage[], images?: ImageInput[]): ChatMessage[] {
  const base: ChatMessage[] = messages.map(({ role, content }) => ({ role, content }));
  if (!images?.length) return base;

  let lastUserIdx = -1;
  for (let i = base.length - 1; i >= 0; i--) {
    if (base[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return base;

  const target = base[lastUserIdx]!;
  const text = typeof target.content === "string" ? target.content : "";
  base[lastUserIdx] = {
    role: target.role,
    content: [
      { type: "text", text },
      ...images.map(
        (img): ChatContentPart => ({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` }
        })
      )
    ]
  };
  return base;
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
        messages: buildChatMessages(input.messages, input.images),
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
