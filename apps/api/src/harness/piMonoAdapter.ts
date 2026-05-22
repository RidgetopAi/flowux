import type { FlowuxTurnEvent } from "@flowux/shared";
import type { FlowuxToolCall, FlowuxToolResult } from "@flowux/shared";
import type { FlowuxConfig } from "../config.js";
import type { HarnessAdapter, HarnessTurnInput } from "./types.js";

type PiRpcEvent = Record<string, unknown> & { type?: string };

export function mapPiMonoEvent(raw: PiRpcEvent): FlowuxTurnEvent[] {
  if (raw.type === "turn_start") return [{ type: "turn_started", raw }];
  if (raw.type === "turn_end") return [{ type: "done", raw }];

  if (raw.type === "message_update") {
    const assistantEvent = raw.assistantMessageEvent as Record<string, unknown> | undefined;
    if (!assistantEvent || typeof assistantEvent.type !== "string") {
      return [{ type: "raw_event", eventType: "message_update", raw }];
    }

    if (assistantEvent.type === "text_delta" && typeof assistantEvent.delta === "string") {
      return [{ type: "response_delta", text: assistantEvent.delta, raw }];
    }

    if (assistantEvent.type === "thinking_delta" && typeof assistantEvent.delta === "string") {
      return [{ type: "thinking_delta", text: assistantEvent.delta, raw }];
    }

    if (assistantEvent.type === "toolcall_start") {
      return [{ type: "tool_call_started", toolCall: toToolCall(assistantEvent), raw }];
    }

    if (assistantEvent.type === "toolcall_delta") {
      return [{ type: "tool_call_delta", toolCall: toToolCall(assistantEvent), delta: assistantEvent.delta, raw }];
    }

    if (assistantEvent.type === "toolcall_end") {
      return [{ type: "tool_call_completed", toolCall: toToolCall(assistantEvent), raw }];
    }

    if (assistantEvent.type === "done") {
      return [{ type: "done", finishReason: stringValue(assistantEvent.reason), raw }];
    }

    if (assistantEvent.type === "error") {
      return [{ type: "error", message: stringValue(assistantEvent.reason) ?? "pi_mono_message_error", raw }];
    }

    return [{ type: "raw_event", eventType: `message_update.${assistantEvent.type}`, raw }];
  }

  if (raw.type === "tool_execution_start") {
    return [{ type: "tool_call_started", toolCall: piToolCall(raw, "started"), raw }];
  }

  if (raw.type === "tool_execution_update") {
    return [{ type: "tool_result_delta", toolResult: piToolResult(raw), raw }];
  }

  if (raw.type === "tool_execution_end") {
    const toolResult = piToolResult(raw);
    return [
      { type: "tool_result_completed", toolResult, raw },
      { type: "tool_call_completed", toolCall: piToolCall(raw, toolResult.isError ? "error" : "complete"), raw }
    ];
  }

  return [{ type: "raw_event", eventType: raw.type ?? "unknown", raw }];
}

export class PiMonoHarnessAdapter implements HarnessAdapter {
  mode = "pi_mono" as const;
  provider = "pi_mono" as const;
  model: string;
  capabilities = {
    thinking: true,
    toolCalls: true,
    toolResults: true,
    files: true,
    artifacts: true,
    tokenUsage: true,
    rawEvents: true
  };

  constructor(private readonly config: FlowuxConfig) {
    this.model = config.piMonoModel;
  }

  async *generate(_input: HarnessTurnInput): AsyncGenerator<FlowuxTurnEvent> {
    yield {
      type: "error",
      message:
        "Pi-Mono harness mode is selected, but the remote RPC runner is not wired yet. Keep FLOWUX_HARNESS_MODE=direct_model until the desktop Pi bridge is configured.",
      raw: {
        remoteHost: this.config.piMonoRemoteHost,
        remoteCwd: this.config.piMonoRemoteCwd,
        command: this.config.piMonoCommand
      }
    };
    yield { type: "done", finishReason: "adapter_not_configured" };
  }
}

function toToolCall(event: Record<string, unknown>): FlowuxToolCall {
  const toolCall = event.toolCall as Record<string, unknown> | undefined;
  return {
    id: stringValue(event.toolCallId) ?? stringValue(toolCall?.id) ?? `tool-${stringValue(event.contentIndex) ?? "unknown"}`,
    name: stringValue(event.toolName) ?? stringValue(toolCall?.name) ?? "tool",
    args: event.args ?? toolCall?.args,
    status: event.type === "toolcall_end" ? "complete" : "streaming"
  };
}

function piToolCall(event: Record<string, unknown>, status: FlowuxToolCall["status"]): FlowuxToolCall {
  return {
    id: stringValue(event.toolCallId) ?? "tool-unknown",
    name: stringValue(event.toolName) ?? "tool",
    args: event.args,
    status
  };
}

function piToolResult(event: Record<string, unknown>): FlowuxToolResult {
  return {
    toolCallId: stringValue(event.toolCallId) ?? "tool-unknown",
    toolName: stringValue(event.toolName),
    result: event.partialResult ?? event.result,
    isError: event.isError === true
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
