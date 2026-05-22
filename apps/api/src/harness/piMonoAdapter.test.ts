import { describe, expect, test } from "vitest";
import { mapPiMonoEvent } from "./piMonoAdapter.js";

describe("mapPiMonoEvent", () => {
  test("maps text and thinking deltas into portable Flowux events", () => {
    expect(
      mapPiMonoEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" }
      })
    ).toEqual([{ type: "response_delta", text: "hello", raw: expect.any(Object) }]);

    expect(
      mapPiMonoEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "trace" }
      })
    ).toEqual([{ type: "thinking_delta", text: "trace", raw: expect.any(Object) }]);
  });

  test("maps Pi tool execution lifecycle into tool call and result events", () => {
    expect(
      mapPiMonoEvent({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "pwd" }
      })
    ).toEqual([
      {
        type: "tool_call_started",
        toolCall: { id: "call-1", name: "bash", args: { command: "pwd" }, status: "started" },
        raw: expect.any(Object)
      }
    ]);

    expect(
      mapPiMonoEvent({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "/tmp" }] },
        isError: false
      })
    ).toEqual([
      {
        type: "tool_result_completed",
        toolResult: {
          toolCallId: "call-1",
          toolName: "bash",
          result: { content: [{ type: "text", text: "/tmp" }] },
          isError: false
        },
        raw: expect.any(Object)
      },
      {
        type: "tool_call_completed",
        toolCall: { id: "call-1", name: "bash", args: undefined, status: "complete" },
        raw: expect.any(Object)
      }
    ]);
  });

  test("maps turn end usage into portable usage before done", () => {
    expect(
      mapPiMonoEvent({
        type: "turn_end",
        message: {
          stopReason: "stop",
          usage: {
            input: 10,
            output: 5,
            totalTokens: 15
          }
        }
      })
    ).toEqual([
      {
        type: "usage",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        raw: expect.any(Object)
      },
      { type: "done", finishReason: "stop", raw: expect.any(Object) }
    ]);
  });

  test("marks tool-use turn end as non-final so the RPC stream can continue", () => {
    expect(
      mapPiMonoEvent({
        type: "turn_end",
        message: {
          stopReason: "toolUse",
          usage: { input: 7, output: 3, totalTokens: 10 }
        }
      }).at(-1)
    ).toEqual({ type: "done", finishReason: "toolUse", raw: expect.any(Object) });
  });

  test("maps RPC timeout errors into portable error events", () => {
    expect(mapPiMonoEvent({ type: "error", reason: "Pi-Mono RPC event stream timed out" })).toEqual([
      { type: "error", message: "Pi-Mono RPC event stream timed out", raw: expect.any(Object) }
    ]);
  });
});
