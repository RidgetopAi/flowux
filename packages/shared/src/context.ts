import type { ContextBudget, ContextMessage, ContextMode, Mrp } from "./types.js";

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

export function estimateContextBudget(input: {
  messages: ContextMessage[];
  contextWindow: number;
  maxOutputTokens: number;
  currentPrompt?: string;
}): ContextBudget {
  const estimatedTokens = input.messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
  const currentPromptTokens = estimateTokens(input.currentPrompt ?? input.messages.at(-1)?.content ?? "");
  const availableInputTokens = Math.max(0, input.contextWindow - input.maxOutputTokens);
  const percentOfWindow = input.contextWindow > 0 ? Math.round((estimatedTokens / input.contextWindow) * 1000) / 10 : 0;
  const percentOfInputBudget = availableInputTokens > 0 ? Math.round((estimatedTokens / availableInputTokens) * 1000) / 10 : 0;
  return {
    estimatedTokens,
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    availableInputTokens,
    percentOfWindow,
    percentOfInputBudget,
    messageCount: input.messages.length,
    mrpCount: new Set(input.messages.map((message) => message.mrpId).filter(Boolean)).size,
    currentPromptTokens,
    warning: percentOfInputBudget >= 100 ? "over" : percentOfInputBudget >= 80 ? "high" : "ok"
  };
}

export function estimateTokens(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}
