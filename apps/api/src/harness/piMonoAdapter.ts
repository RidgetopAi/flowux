import type { FlowuxTurnEvent } from "@flowux/shared";
import type { FlowuxToolCall, FlowuxToolResult } from "@flowux/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { HarnessAdapter, HarnessTurnInput } from "./types.js";
import type { PiTarget } from "./targets.js";

type PiRpcEvent = Record<string, unknown> & { type?: string };
const PI_PROMPT_ACK_TIMEOUT_MS = 30_000;
const PI_EVENT_IDLE_TIMEOUT_MS = 120_000;

export function mapPiMonoEvent(raw: PiRpcEvent): FlowuxTurnEvent[] {
  if (raw.type === "turn_start") return [{ type: "turn_started", raw }];
  if (raw.type === "turn_end") {
    const usage = extractUsage(raw);
    const finishReason = extractStopReason(raw);
    return [...(usage ? [{ type: "usage" as const, usage, raw }] : []), { type: "done", finishReason, raw }];
  }
  if (raw.type === "error") {
    return [{ type: "error", message: stringValue(raw.reason) ?? "pi_mono_rpc_error", raw }];
  }

  if (raw.type === "message_end" && isAssistantErrorMessage(raw.message)) {
    return [{ type: "error", message: raw.message.errorMessage, raw }];
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

interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
}

/** Pi RPC CLI flags for a target's provider/model. */
function buildPiArgs(target: PiTarget): string[] {
  const args = [
    "--mode", "rpc",
    "--provider", target.provider,
    "--model", target.model,
    "--no-session",
    "--no-context-files",
    "--thinking", target.thinking
  ];
  const extra = process.env.FLOWUX_PI_EXTRA_ARGS?.trim();
  if (extra) args.push(...extra.split(/\s+/));
  return args;
}

/**
 * Turn a target into a concrete spawn. The RPC loop downstream is identical
 * for both transports — only HOW we launch pi differs:
 *   local → spawn the pi binary directly in target.cwd
 *   ssh   → spawn `ssh <host> -- sh -lc 'cd <cwd> && exec pi …'`; stdin/stdout
 *           flow over the SSH pipe transparently, so the JSON-RPC framing is
 *           unchanged. -T disables a pty; BatchMode fails fast instead of
 *           hanging on a password prompt. A login shell (sh -lc) ensures pi is
 *           on PATH on the remote.
 */
export function buildSpawnSpec(target: PiTarget): SpawnSpec {
  const piArgs = buildPiArgs(target);
  if (target.transport === "ssh") {
    if (!target.sshHost) throw new Error(`ssh target ${target.id} is missing sshHost`);
    // The pi invocation, quoted for a POSIX shell on the remote.
    const inner = [
      target.cwd ? `cd ${shellQuote(target.cwd)} && ` : "",
      "exec ",
      [target.bin, ...piArgs].map(shellQuote).join(" ")
    ].join("");
    // ssh joins its trailing args with spaces and hands ONE command string to
    // the remote login shell, which re-parses it. So we pass a single
    // pre-quoted arg: `sh -lc '<inner>'`. sh -lc forces a login shell so pi is
    // on PATH; the outer quote keeps <inner> intact through ssh's re-parse.
    const remoteCommand = `sh -lc ${shellQuote(inner)}`;
    return {
      command: "ssh",
      args: ["-T", "-o", "BatchMode=yes", target.sshHost, remoteCommand],
      cwd: process.cwd()
    };
  }
  return { command: target.bin, args: piArgs, cwd: target.cwd || process.cwd() };
}

/** POSIX single-quote escaping for safe interpolation into the remote shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

  constructor(private readonly target: PiTarget) {
    this.model = target.model;
  }

  async *generate(input: HarnessTurnInput): AsyncGenerator<FlowuxTurnEvent> {
    const session = new PiRpcProcess(this.target);
    const abort = () => void session.stop();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (input.signal?.aborted) throw new Error("Pi-Mono request aborted");
      await session.start();
      if (input.signal?.aborted) throw new Error("Pi-Mono request aborted");
      await session.prompt(formatPiPrompt(input), input.images);

      for await (const raw of session.events()) {
        if (input.signal?.aborted) throw new Error("Pi-Mono request aborted");
        for (const event of mapPiMonoEvent(raw)) {
          yield event;
          if (event.type === "done" && event.finishReason !== "toolUse") {
            return;
          }
        }
      }
    } catch (error) {
      const spec = buildSpawnSpec(this.target);
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "pi_mono_rpc_error",
        raw: {
          targetId: this.target.id,
          command: spec.command,
          args: spec.args,
          cwd: spec.cwd,
          stderr: session.stderr
        }
      };
      yield { type: "done", finishReason: "error" };
    } finally {
      input.signal?.removeEventListener("abort", abort);
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

  constructor(private readonly target: PiTarget) {}

  async start(): Promise<void> {
    const spec = buildSpawnSpec(this.target);
    this.process = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
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

  async prompt(message: string, images: HarnessTurnInput["images"] = []): Promise<void> {
    const process = this.requireProcess();
    const requestId = `flowux-${crypto.randomUUID()}`;
    const preAckEvents: PiRpcEvent[] = [];
    process.stdin.write(`${JSON.stringify({ id: requestId, type: "prompt", message, ...(images?.length ? { images } : {}) })}\n`);

    while (true) {
      const raw = await this.nextEvent(PI_PROMPT_ACK_TIMEOUT_MS, "Pi-Mono prompt acknowledgement timed out");
      if (!raw) throw new Error(`Pi-Mono RPC ended before prompt acknowledgement. stderr: ${this.stderr.trim()}`);
      if (raw.type === "error") {
        throw new Error(`${stringValue(raw.reason) ?? "Pi-Mono prompt failed"}. stderr: ${this.stderr.trim()}`);
      }
      if (raw.type !== "response" || raw.id !== requestId) {
        preAckEvents.push(raw);
        continue;
      }
      if (raw.success === false) {
        throw new Error(`Pi-Mono prompt rejected: ${stringValue(raw.error) ?? "unknown_error"}`);
      }
      this.eventsQueue.unshift(...preAckEvents);
      return;
    }
  }

  async *events(): AsyncGenerator<PiRpcEvent> {
    while (true) {
      const event = await this.nextEvent(PI_EVENT_IDLE_TIMEOUT_MS, "Pi-Mono RPC event stream timed out");
      if (!event) return;
      if (event.type === "response") continue;
      yield event;
      if (event.type === "error") return;
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

  private nextEvent(timeoutMs?: number, timeoutMessage?: string): Promise<PiRpcEvent | undefined> {
    const event = this.eventsQueue.shift();
    if (event) return Promise.resolve(event);

    if (this.process?.exitCode !== null && this.eventsQueue.length === 0) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const waiter = (event: PiRpcEvent | undefined) => {
        if (timeout) clearTimeout(timeout);
        resolve(event);
      };
      this.waiters.push(waiter);
      if (timeoutMs) {
        timeout = setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          resolve({
            type: "error",
            reason: timeoutMessage ?? "Pi-Mono RPC timed out",
            stderr: this.stderr.trim()
          });
        }, timeoutMs);
      }
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

export interface PiPingResult {
  ok: boolean;
  targetId: string;
  model: string;
  transport: PiTarget["transport"];
  latencyMs: number;
  error?: string;
}

/**
 * Connectivity check for a target: spawn pi the same way a real prompt would
 * (local or over ssh), send a trivial prompt, and wait for the FIRST
 * meaningful generation event. Seeing any token/turn/end proves the whole
 * path is live — ssh reachable, pi present, model server actually answering —
 * not just that the process launched. An error event or timeout = not
 * reachable. The in-flight generation is killed immediately after.
 */
export async function pingTarget(target: PiTarget, timeoutMs = 25_000): Promise<PiPingResult> {
  const startedAt = Date.now();
  const session = new PiRpcProcess(target);
  const result = (ok: boolean, error?: string): PiPingResult => ({
    ok,
    targetId: target.id,
    model: target.model,
    transport: target.transport,
    latencyMs: Date.now() - startedAt,
    ...(error ? { error } : {})
  });

  const timer = new Promise<PiPingResult>((resolve) => {
    setTimeout(() => resolve(result(false, "connectivity check timed out")), timeoutMs);
  });

  const probe = (async (): Promise<PiPingResult> => {
    try {
      await session.start();
      await session.prompt("Reply with exactly: ok");
      for await (const raw of session.events()) {
        if (raw.type === "error") {
          return result(false, stringValue(raw.reason) ?? "pi reported an error");
        }
        // First sign of life from the model = reachable.
        if (
          raw.type === "turn_start" ||
          raw.type === "turn_end" ||
          raw.type === "agent_end" ||
          raw.type === "message_update"
        ) {
          return result(true);
        }
      }
      return result(false, `pi stream ended without output. stderr: ${session.stderr.trim()}`.trim());
    } catch (error) {
      return result(false, error instanceof Error ? error.message : "connectivity check failed");
    }
  })();

  try {
    return await Promise.race([probe, timer]);
  } finally {
    await session.stop();
  }
}

function formatPiPrompt(input: HarnessTurnInput): string {
  const contextualMessages = input.messages.filter((message) => message.role !== "system");
  const runtimeContext = formatRuntimeContext(input);
  if (contextualMessages.length <= 1) {
    return [runtimeContext, input.prompt].filter(Boolean).join("\n\n");
  }

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
    runtimeContext,
    context,
    "Current user prompt:",
    input.prompt
  ].join("\n\n");
}

function formatRuntimeContext(input: HarnessTurnInput): string | undefined {
  const context = input.executionContext;
  if (!context) return undefined;

  return [
    "Flowux runtime context:",
    `- Harness: ${context.harness}`,
    context.hostLabel ? `- Tool host: ${context.hostLabel}` : undefined,
    context.workspaceLabel ? `- Tool workspace: ${context.workspaceLabel}` : undefined,
    context.filesystemScope ? `- Filesystem scope: ${context.filesystemScope}` : undefined,
    context.toolCapabilities.length ? `- Tool capabilities: ${context.toolCapabilities.join(", ")}` : undefined,
    context.warning ? `- Boundary: ${context.warning}` : undefined,
    "Use this runtime context when reasoning about filesystem paths and tool access."
  ]
    .filter(Boolean)
    .join("\n");
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

function isAssistantErrorMessage(value: unknown): value is { role: "assistant"; errorMessage: string } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.role === "assistant" && typeof message.errorMessage === "string" && message.errorMessage.length > 0;
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
