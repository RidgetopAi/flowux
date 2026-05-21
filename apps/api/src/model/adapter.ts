import type { ContextMessage, ModelProvider } from "@flowux/shared";
import { loadConfig } from "../config.js";

export interface GenerateInput {
  messages: ContextMessage[];
}

export interface ModelAdapter {
  provider: ModelProvider;
  model: string;
  generate(input: GenerateInput): AsyncGenerator<string>;
}

export function createModelAdapter(): ModelAdapter {
  const config = loadConfig();
  if (config.modelMode === "llama_cpp") {
    return new LlamaCppAdapter(config.modelBaseUrl, config.modelName);
  }
  return new MockAdapter(config.modelName);
}

class MockAdapter implements ModelAdapter {
  provider: ModelProvider = "mock";

  constructor(public model: string) {}

  async *generate(input: GenerateInput): AsyncGenerator<string> {
    const latest = input.messages.at(-1)?.content ?? "";
    const text = [
      "Mock Flowux response.",
      "This confirms the prompt-to-MRP path, persistence, and context assembly are wired.",
      `Latest prompt: ${latest}`
    ].join("\n\n");

    for (const token of text.split(/(\s+)/)) {
      yield token;
    }
  }
}

class LlamaCppAdapter implements ModelAdapter {
  provider: ModelProvider = "llama_cpp";

  constructor(
    private readonly baseUrl: string,
    public model: string
  ) {}

  async *generate(input: GenerateInput): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: input.messages.map(({ role, content }) => ({ role, content })),
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`llama.cpp request failed: ${response.status} ${body}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }
}

