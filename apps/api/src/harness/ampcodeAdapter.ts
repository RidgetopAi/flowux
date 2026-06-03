import type {
  ContextMessage,
  FlowuxToolCall,
  FlowuxToolResult,
  FlowuxTurnEvent,
  TurnTokenUsage
} from "@flowux/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { FlowuxConfig } from "../config.js";
import type { HarnessAdapter, HarnessTurnInput } from "./types.js";

/**
 * AmpCode harness — connector #3 (after direct_model and pi_mono). It proves
 * the HarnessAdapter seam generalizes to a structurally different agent.
 *
 * Amp's lifecycle is the OPPOSITE of pi's persistent RPC: `amp -x` runs the
 * ENTIRE agent loop (its own tool execution included) to completion, streams
 * Claude-Code-compatible JSON Lines on stdout, then EXITS. So this adapter is
 * spawn-per-turn — structurally like directModelAdapter (a generator that
 * spawns, streams, maps, finishes) with pi's stdout-JSONL/stderr/abort
 * plumbing, but WITHOUT the RPC machinery (no ack handshake, no request-id
 * correlation, no waiters/queue, no keep-alive, no tool-use continuation loop —
 * Amp loops internally, just like pi does).
 *
 * The event shapes below are pinned to a REAL `amp -x --stream-json
 * --stream-json-thinking` capture (Amp 0.0.1778443915), not the docs:
 *  - `system/init`   metadata (cwd, tools, mcp_servers, agent_mode, reasoning_effort)
 *  - `user`          DUAL-PURPOSE: the prompt echo (text blocks) OR a tool_result
 *                    (tool_result blocks) — branch on the content block type.
 *  - `assistant`     message.content[] of {text|thinking|tool_use} blocks;
 *                    token usage rides on EACH assistant message (message.usage),
 *                    NOT on the result event.
 *  - `result`        terminal; carries subtype/is_error/result, NO usage/cost.
 *
 * Amp emits WHOLE-message content blocks, not token-level deltas — so a
 * response_delta carries a full text block at once (chunkier than pi's
 * text_delta stream). The server consumer accumulates responseText and flushes
 * on `done`, so it is granularity-agnostic; the only effect is chunkier typing.
 */

type AmpEvent = Record<string, unknown> & { type?: string };
type AmpBlock = Record<string, unknown> & { type?: string };

const AMP_KILL_GRACE_MS = 150;

export function mapAmpEvent(raw: AmpEvent): FlowuxTurnEvent[] {
  switch (raw.type) {
    case "system":
      // init metadata (tools/mcp/cwd/mode) — not a turn boundary, but never drop.
      return [{ type: "raw_event", eventType: `system.${stringValue(raw.subtype) ?? "event"}`, raw }];

    case "user":
      return mapUserMessage(raw);

    case "assistant":
      return mapAssistantMessage(raw);

    case "result": {
      const isError = raw.is_error === true || raw.subtype === "error";
      if (isError) {
        const message = stringValue(raw.result) ?? stringValue(raw.error) ?? "amp_result_error";
        return [
          { type: "error", message, raw },
          { type: "done", finishReason: "error", raw }
        ];
      }
      // The final assistant text was already streamed via the last assistant
      // message's text block, so do NOT re-emit raw.result here (would duplicate).
      return [{ type: "done", finishReason: "stop", raw }];
    }

    default:
      return [{ type: "raw_event", eventType: stringValue(raw.type) ?? "unknown", raw }];
  }
}

/** A `user` event is either the prompt echo (text blocks) or tool results. */
function mapUserMessage(raw: AmpEvent): FlowuxTurnEvent[] {
  const blocks = messageContent(raw);
  const events: FlowuxTurnEvent[] = [];
  let sawToolResult = false;

  for (const block of blocks) {
    if (block.type === "tool_result") {
      sawToolResult = true;
      events.push({
        type: "tool_result_completed",
        toolResult: toToolResult(block),
        raw
      });
    }
  }

  // No tool_result blocks → this is the echo of our own prompt. Keep it as a
  // raw_event (never dropped) but do not surface it as model output.
  if (!sawToolResult) {
    return [{ type: "raw_event", eventType: "user.prompt_echo", raw }];
  }
  return events;
}

function mapAssistantMessage(raw: AmpEvent): FlowuxTurnEvent[] {
  const blocks = messageContent(raw);
  const events: FlowuxTurnEvent[] = [];

  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      events.push({ type: "response_delta", text: block.text, raw });
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      events.push({ type: "thinking_delta", text: block.thinking, raw });
    } else if (block.type === "tool_use") {
      // Whole block arrives at once — no streaming deltas — so emit
      // started + completed back-to-back.
      const toolCall = toToolCall(block);
      events.push({ type: "tool_call_started", toolCall: { ...toolCall, status: "started" }, raw });
      events.push({ type: "tool_call_completed", toolCall: { ...toolCall, status: "complete" }, raw });
    } else {
      events.push({ type: "raw_event", eventType: `assistant.${stringValue(block.type) ?? "block"}`, raw });
    }
  }

  // Usage rides on each assistant message; emit it so the server keeps the
  // latest as the turn's final usage.
  const usage = extractUsage(raw);
  if (usage) events.push({ type: "usage", usage, raw });

  return events;
}

function messageContent(raw: AmpEvent): AmpBlock[] {
  const message = raw.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content as AmpBlock[]) : [];
}

function toToolCall(block: AmpBlock): FlowuxToolCall {
  return {
    id: stringValue(block.id) ?? `amp-tool-${stringValue(block.name) ?? "unknown"}`,
    name: stringValue(block.name) ?? "tool",
    args: block.input,
    status: "complete"
  };
}

function toToolResult(block: AmpBlock): FlowuxToolResult {
  return {
    toolCallId: stringValue(block.tool_use_id) ?? "amp-tool-unknown",
    result: block.content,
    isError: block.is_error === true
  };
}

function extractUsage(raw: AmpEvent): TurnTokenUsage | undefined {
  const message = raw.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  const input = numberValue(usage.input_tokens) ?? 0;
  const cacheCreate = numberValue(usage.cache_creation_input_tokens) ?? 0;
  const cacheRead = numberValue(usage.cache_read_input_tokens) ?? 0;
  const output = numberValue(usage.output_tokens) ?? 0;
  const promptTokens = input + cacheCreate + cacheRead;
  return {
    promptTokens,
    completionTokens: output,
    totalTokens: promptTokens + output
  };
}

export class AmpCodeHarnessAdapter implements HarnessAdapter {
  mode = "ampcode" as const;
  provider = "ampcode" as const;
  model: string;
  capabilities = {
    thinking: true,
    toolCalls: true,
    toolResults: true,
    files: true,
    artifacts: false,
    tokenUsage: true,
    rawEvents: true
  };

  constructor(private readonly config: FlowuxConfig) {
    this.model = `amp:${config.ampMode}`;
  }

  async *generate(input: HarnessTurnInput): AsyncGenerator<FlowuxTurnEvent> {
    yield { type: "turn_started" };

    const spec = buildAmpSpawnSpec(this.config);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(spec.command, spec.args, { cwd: spec.cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "ampcode_spawn_failed",
        raw: { command: spec.command, args: spec.args, cwd: spec.cwd }
      };
      yield { type: "done", finishReason: "error" };
      return;
    }

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const abort = () => {
      if (child.exitCode === null) child.kill("SIGTERM");
    };
    input.signal?.addEventListener("abort", abort, { once: true });

    const reader = createInterface({ input: child.stdout, terminal: false });

    // Feed the prompt and close stdin so amp begins the agent loop.
    child.stdin.write(formatAmpPrompt(input));
    child.stdin.end();

    let sawDone = false;
    try {
      if (input.signal?.aborted) throw new Error("Amp request aborted");

      for await (const line of reader) {
        if (input.signal?.aborted) throw new Error("Amp request aborted");
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: AmpEvent | undefined;
        try {
          parsed = JSON.parse(trimmed) as AmpEvent;
        } catch {
          yield { type: "raw_event", eventType: "raw_stdout", raw: { line: trimmed } };
          continue;
        }

        for (const event of mapAmpEvent(parsed)) {
          yield event;
          if (event.type === "done") {
            sawDone = true;
            return; // amp's result event is terminal — no continuation loop.
          }
        }
      }

      // Stream ended without a `result` line (crash, auth failure, etc.).
      const code = await onceExit(child);
      if (!sawDone) {
        if (code !== 0) {
          yield {
            type: "error",
            message: ampErrorMessage(code, stderr),
            raw: { code, stderr, command: spec.command, args: spec.args, cwd: spec.cwd }
          };
        }
        yield { type: "done", finishReason: code === 0 ? "stop" : "error" };
      }
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "ampcode_error",
        raw: { command: spec.command, args: spec.args, cwd: spec.cwd, stderr }
      };
      yield { type: "done", finishReason: "error" };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      reader.close();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await wait(AMP_KILL_GRACE_MS);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    }
  }
}

interface AmpSpawnSpec {
  command: string;
  args: string[];
  cwd: string;
}

export function buildAmpSpawnSpec(config: FlowuxConfig): AmpSpawnSpec {
  const args = ["-x", "--stream-json", "--stream-json-thinking", "-m", config.ampMode];
  if (config.ampDangerouslyAllowAll) args.push("--dangerously-allow-all");
  if (config.ampEffort) args.push("--effort", config.ampEffort);
  args.push(...config.ampExtraArgs);
  return { command: config.ampBin, args, cwd: config.ampCwd || process.cwd() };
}

function ampErrorMessage(code: number | null, stderr: string): string {
  const trimmed = stderr.trim();
  if (/api[_\s-]?key|unauthor|auth|login|forbidden|401|403/i.test(trimmed)) {
    return `Amp auth failed — set AMP_API_KEY or run \`amp login\` (~/.config/amp/settings.json). exit=${code}. ${trimmed}`.trim();
  }
  return `Amp exited with code ${code}. ${trimmed}`.trim();
}

/**
 * Fold MRP context + runtime context + the current prompt into a single stdin
 * string. Like pi via stdin, amp gets context as plain text (NOT system
 * messages). Mirrors piMonoAdapter.formatPiPrompt — extracting a shared helper
 * is a follow-up (see plan seam-gaps).
 */
function formatAmpPrompt(input: HarnessTurnInput): string {
  const contextualMessages = input.messages.filter((message) => message.role !== "system");
  const runtimeContext = formatRuntimeContext(input);
  if (contextualMessages.length <= 1) {
    return [runtimeContext, input.prompt].filter(Boolean).join("\n\n");
  }

  const context = contextualMessages
    .slice(0, -1)
    .map((message: ContextMessage) => {
      const label = message.role === "assistant" ? "Assistant" : "User";
      const source = message.mrpId ? ` (${message.mrpId})` : "";
      return `${label}${source}:\n${message.content}`;
    })
    .join("\n\n---\n\n");

  return [
    "Flowux selected MRP context follows. Use it as working context, but keep your normal Amp project instructions and tools.",
    runtimeContext,
    context,
    "Current user prompt:",
    input.prompt
  ]
    .filter(Boolean)
    .join("\n\n");
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

function onceExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
