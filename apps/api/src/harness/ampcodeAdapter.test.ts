import { describe, expect, test } from "vitest";
import { mapAmpEvent } from "./ampcodeAdapter.js";

// All fixtures below are taken from a REAL `amp -x --stream-json
// --stream-json-thinking` capture (Amp 0.0.1778443915), so the mapping is
// pinned to actual bytes, not the docs.

describe("mapAmpEvent", () => {
  test("maps an assistant text block into a single response_delta (whole block, no token deltas)", () => {
    expect(
      mapAmpEvent({
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "amp sample done." }],
          stop_reason: "end_turn"
        }
      })
    ).toEqual([{ type: "response_delta", text: "amp sample done.", raw: expect.any(Object) }]);
  });

  test("maps an assistant thinking block into a thinking_delta", () => {
    expect(
      mapAmpEvent({
        type: "assistant",
        message: { type: "message", role: "assistant", content: [{ type: "thinking", thinking: "trace" }] }
      })
    ).toEqual([{ type: "thinking_delta", text: "trace", raw: expect.any(Object) }]);
  });

  test("maps an assistant tool_use block into started + completed back-to-back", () => {
    expect(
      mapAmpEvent({
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "tool_use", id: "TU-1", name: "Bash", input: { cmd: "pwd" } }],
          stop_reason: "tool_use"
        }
      })
    ).toEqual([
      { type: "tool_call_started", toolCall: { id: "TU-1", name: "Bash", args: { cmd: "pwd" }, status: "started" }, raw: expect.any(Object) },
      { type: "tool_call_completed", toolCall: { id: "TU-1", name: "Bash", args: { cmd: "pwd" }, status: "complete" }, raw: expect.any(Object) }
    ]);
  });

  test("emits per-message usage (summing cache tokens into prompt) after the blocks", () => {
    const events = mapAmpEvent({
      type: "assistant",
      message: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        usage: {
          input_tokens: 6,
          cache_creation_input_tokens: 34911,
          cache_read_input_tokens: 0,
          output_tokens: 67
        }
      }
    });
    expect(events).toEqual([
      { type: "response_delta", text: "hi", raw: expect.any(Object) },
      { type: "usage", usage: { promptTokens: 34917, completionTokens: 67, totalTokens: 34984 }, raw: expect.any(Object) }
    ]);
  });

  test("maps a user tool_result message into tool_result_completed", () => {
    expect(
      mapAmpEvent({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "TU-1",
              content: '{"output":"/home/ridgetop/projects/flowux\\n","exitCode":0}',
              is_error: false
            }
          ]
        }
      })
    ).toEqual([
      {
        type: "tool_result_completed",
        toolResult: {
          toolCallId: "TU-1",
          result: '{"output":"/home/ridgetop/projects/flowux\\n","exitCode":0}',
          isError: false
        },
        raw: expect.any(Object)
      }
    ]);
  });

  test("treats a user text message as the prompt echo (raw_event, not model output)", () => {
    expect(
      mapAmpEvent({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "Print the cwd." }] }
      })
    ).toEqual([{ type: "raw_event", eventType: "user.prompt_echo", raw: expect.any(Object) }]);
  });

  test("maps a successful result into a terminal done (no usage on result)", () => {
    expect(
      mapAmpEvent({ type: "result", subtype: "success", is_error: false, result: "amp sample done.", num_turns: 2 })
    ).toEqual([{ type: "done", finishReason: "stop", raw: expect.any(Object) }]);
  });

  test("maps an error result into error + done", () => {
    expect(
      mapAmpEvent({ type: "result", subtype: "error", is_error: true, result: "rate limited" })
    ).toEqual([
      { type: "error", message: "rate limited", raw: expect.any(Object) },
      { type: "done", finishReason: "error", raw: expect.any(Object) }
    ]);
  });

  test("maps system/init into a raw_event (not a turn boundary)", () => {
    expect(mapAmpEvent({ type: "system", subtype: "init", agent_mode: "smart" })).toEqual([
      { type: "raw_event", eventType: "system.init", raw: expect.any(Object) }
    ]);
  });

  test("preserves block order across a mixed assistant message", () => {
    const events = mapAmpEvent({
      type: "assistant",
      message: {
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me check" },
          { type: "text", text: "Running it." },
          { type: "tool_use", id: "TU-2", name: "Bash", input: { cmd: "ls" } }
        ]
      }
    });
    expect(events.map((e) => e.type)).toEqual([
      "thinking_delta",
      "response_delta",
      "tool_call_started",
      "tool_call_completed"
    ]);
  });

  test("falls back to raw_event for unknown line types", () => {
    expect(mapAmpEvent({ type: "mystery" })).toEqual([
      { type: "raw_event", eventType: "mystery", raw: expect.any(Object) }
    ]);
  });
});
