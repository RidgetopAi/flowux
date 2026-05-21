import type { ContextMessage, ContextMode, Mrp } from "./types.js";

export interface BuildContextInput {
  mrps: Mrp[];
  selectedMrpIds: string[];
  modeByMrpId?: Record<string, ContextMode>;
  systemPrompt?: string;
  projectInstructions?: string;
  currentPrompt: string;
}

export function buildContextMessages(input: BuildContextInput): ContextMessage[] {
  const selected = new Set(input.selectedMrpIds);
  const modes = input.modeByMrpId ?? {};
  const messages: ContextMessage[] = [];

  if (input.systemPrompt?.trim()) {
    messages.push({ role: "system", content: input.systemPrompt.trim() });
  }

  if (input.projectInstructions?.trim()) {
    messages.push({ role: "user", content: `Project instructions:\n${input.projectInstructions.trim()}` });
  }

  const selectedMrps = input.mrps
    .filter((mrp) => selected.has(mrp.id))
    .sort((a, b) => a.sequence - b.sequence);

  for (const mrp of selectedMrps) {
    const mode = modes[mrp.id] ?? "full_mrp";
    if (mode === "none") continue;

    if (mode === "summary") {
      messages.push({
        role: "user",
        content: `Prior MRP ${mrp.sequence} summary:\n${mrp.summary ?? mrp.title ?? mrp.userPrompt}`,
        mrpId: mrp.id
      });
      continue;
    }

    messages.push({ role: "user", content: mrp.userPrompt, mrpId: mrp.id });

    if (mode === "response_only" || mode === "full_mrp") {
      messages.push({ role: "assistant", content: mrp.assistantResponse, mrpId: mrp.id });
    }
  }

  messages.push({ role: "user", content: input.currentPrompt });
  return messages;
}

