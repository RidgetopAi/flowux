import type { FlowuxTurnEvent } from "@flowux/shared";
import type { FlowuxToolCall, FlowuxToolResult } from "@flowux/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { FlowuxConfig } from "../config.js";
import type { HarnessAdapter, HarnessTurnInput } from "./types.js";

type PiRpcEvent = Record<string, unknown> & { type?: string };

export function mapPiMonoEvent(raw: PiRpcEvent): FlowuxTurnEvent[] {
  if (raw.type === "turn_start") return [{ type: "turn_started", raw }];
  if (raw.type === "turn_end") {
    const usage = extractUsage(raw);
    const finishReason = extractStopReason(raw);
    return [...(usage ? [{ type: "usage" as const, usage, raw }] : []), { type: "done", finishReason, raw }];
  }

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

  async *generate(input: HarnessTurnInput): AsyncGenerator<FlowuxTurnEvent> {
    const session = new PiRpcProcess(this.config);
    try {
      await session.start();
      await session.prompt(formatPiPrompt(input));

      for await (const raw of session.events()) {
        for (const event of mapPiMonoEvent(raw)) {
          yield event;
          if (event.type === "done" && event.finishReason !== "toolUse") {
            return;
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "pi_mono_rpc_error",
        raw: {
          remoteHost: this.config.piMonoRemoteHost,
          remoteCwd: this.config.piMonoRemoteCwd,
          command: this.config.piMonoCommand,
          stderr: session.stderr
        }
      };
      yield { type: "done", finishReason: "error" };
    } finally {
      await session.stop();
    }
  }
}

class PiRpcProcess {
  private process?: ChildProcessWithoutNullStreams;
  private eventsQueue: PiRpcEvent[] = [];
  private waiters: Array<(event: PiRpcEvent | undefined) => void> = [];
  private startResponse?: Promise<void>;
  stderr = "";

  constructor(private readonly config: FlowuxConfig) {}

  async start(): Promise<void> {
    const remoteCommand = `cd ${shellQuote(this.config.piMonoRemoteCwd)} && ${this.config.piMonoCommand}`;
    this.process = spawn("ssh", [this.config.piMonoRemoteHost, remoteCommand], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });

    this.process.on("exit", () => {
      this.resolveWaiter(undefined);
    });

    const lineReader = createInterface({ input: this.process.stdout, terminal: false });
    lineReader.on("line", (line) => this.handleLine(line));

    this.startResponse = wait(250);
    await this.startResponse;

    if (this.process.exitCode !== null) {
      throw new Error(`Pi-Mono RPC process exited before prompt. stderr: ${this.stderr.trim()}`);
    }
  }

  async prompt(message: string): Promise<void> {
    const process = this.requireProcess();
    const requestId = `flowux-${crypto.randomUUID()}`;
    process.stdin.write(`${JSON.stringify({ id: requestId, type: "prompt", message })}\n`);

    while (true) {
      const raw = await this.nextEvent();
      if (!raw) throw new Error(`Pi-Mono RPC ended before prompt acknowledgement. stderr: ${this.stderr.trim()}`);
      if (raw.type !== "response" || raw.id !== requestId) {
        this.pushEvent(raw);
        continue;
      }
      if (raw.success === false) {
        throw new Error(`Pi-Mono prompt rejected: ${stringValue(raw.error) ?? "unknown_error"}`);
      }
      return;
    }
  }

  async *events(): AsyncGenerator<PiRpcEvent> {
    while (true) {
      const event = await this.nextEvent();
      if (!event) return;
      if (event.type === "response") continue;
      yield event;
      if (event.type === "agent_end") return;
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    if (this.process.exitCode === null) {
      this.process.kill("SIGTERM");
      await wait(150);
      if (this.process.exitCode === null) this.process.kill("SIGKILL");
    }
    this.resolveWaiter(undefined);
    this.process = undefined;
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      this.pushEvent(JSON.parse(trimmed) as PiRpcEvent);
    } catch {
      this.pushEvent({ type: "raw_stdout", line: trimmed });
    }
  }

  private pushEvent(event: PiRpcEvent) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    this.eventsQueue.push(event);
  }

  private nextEvent(): Promise<PiRpcEvent | undefined> {
    const event = this.eventsQueue.shift();
    if (event) return Promise.resolve(event);

    if (this.process?.exitCode !== null && this.eventsQueue.length === 0) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private resolveWaiter(event: PiRpcEvent | undefined) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
  }

  private requireProcess(): ChildProcessWithoutNullStreams {
    if (!this.process || this.process.exitCode !== null) {
      throw new Error(`Pi-Mono RPC process is not running. stderr: ${this.stderr.trim()}`);
    }
    return this.process;
  }
}

function formatPiPrompt(input: HarnessTurnInput): string {
  const contextualMessages = input.messages.filter((message) => message.role !== "system");
  if (contextualMessages.length <= 1) return input.prompt;

  const context = contextualMessages
    .slice(0, -1)
    .map((message) => {
      const label = message.role === "assistant" ? "Assistant" : "User";
      const source = message.mrpId ? ` (${message.mrpId})` : "";
      return `${label}${source}:\n${message.content}`;
    })
    .join("\n\n---\n\n");

  return [
    "Flowux selected MRP context follows. Use it as working context, but keep your normal Pi-Mono project instructions and tools.",
    context,
    "Current user prompt:",
    input.prompt
  ].join("\n\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function extractUsage(event: Record<string, unknown>) {
  const message = event.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  return {
    promptTokens: numberValue(usage.input),
    completionTokens: numberValue(usage.output),
    totalTokens: numberValue(usage.totalTokens)
  };
}

function extractStopReason(event: Record<string, unknown>): string | undefined {
  const message = event.message as Record<string, unknown> | undefined;
  return stringValue(message?.stopReason);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
