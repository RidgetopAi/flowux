import type { ContextMessage } from "@flowux/shared";
import { describe, expect, test } from "vitest";
import { buildChatMessages } from "./adapter.js";

const convo: ContextMessage[] = [
  { role: "system", content: "be helpful" },
  { role: "user", content: "first" },
  { role: "assistant", content: "ok" },
  { role: "user", content: "look at this" }
];

describe("buildChatMessages", () => {
  test("no images → plain string content, untouched", () => {
    expect(buildChatMessages(convo)).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "look at this" }
    ]);
  });

  test("attaches images as multimodal parts on the LAST user message only", () => {
    const out = buildChatMessages(convo, [{ data: "QUJD", mimeType: "image/png" }]);
    // earlier messages unchanged
    expect(out[0]).toEqual({ role: "system", content: "be helpful" });
    expect(out[1]).toEqual({ role: "user", content: "first" });
    // last user message becomes text + image_url data-uri
    expect(out[3]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look at this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }
      ]
    });
  });

  test("multiple images all ride the last user message", () => {
    const out = buildChatMessages([{ role: "user", content: "two" }], [
      { data: "AA", mimeType: "image/png" },
      { data: "BB", mimeType: "image/jpeg" }
    ]);
    expect(out[0]!.content).toEqual([
      { type: "text", text: "two" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,BB" } }
    ]);
  });

  test("no user message → returns base unchanged (nothing to attach to)", () => {
    const sys: ContextMessage[] = [{ role: "system", content: "only system" }];
    expect(buildChatMessages(sys, [{ data: "AA", mimeType: "image/png" }])).toEqual([
      { role: "system", content: "only system" }
    ]);
  });
});
