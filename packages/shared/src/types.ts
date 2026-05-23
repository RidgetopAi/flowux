export type CanvasStatus = "temporary" | "saved" | "archived";
export type MrpStatus = "pending" | "streaming" | "complete" | "error";
export type ContextMode = "full_mrp" | "summary" | "response_only" | "excerpt" | "none";
export type ArtifactType = "image" | "file" | "code" | "link" | "diff" | "terminal";
export type ModelProvider = "mock" | "llama_cpp" | "openai_compatible" | "pi_mono" | "codex" | "ampcode" | "squire";
export type HarnessMode = "direct_model" | "pi_mono" | "codex" | "ampcode" | "squire";
export type MrpSectionKind =
  | "prompt"
  | "response"
  | "context_sent"
  | "thinking"
  | "tool_calls"
  | "tool_results"
  | "files"
  | "artifacts"
  | "usage"
  | "timeline"
  | "errors"
  | "raw_events";
export type MrpBlockKind =
  | "text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "file_reference"
  | "artifact"
  | "usage"
  | "error"
  | "event";
export type ContextDefault = "include" | "exclude" | "summarize";

export interface ExecutionContext {
  harness: HarnessMode;
  hostLabel?: string;
  workspaceLabel?: string;
  filesystemScope?: string;
  toolCapabilities: string[];
  warning?: string;
}

export interface ContextBudget {
  estimatedTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  availableInputTokens: number;
  percentOfWindow: number;
  percentOfInputBudget: number;
  messageCount: number;
  mrpCount: number;
  currentPromptTokens: number;
  warning?: "ok" | "high" | "over";
}

export interface HealthStatus {
  ok: boolean;
  harnessMode: HarnessMode;
  modelMode: "mock" | "llama_cpp";
  modelBaseUrl: string;
  modelName: string;
  modelMaxTokens: number;
  piMonoRemoteHost: string;
  piMonoRemoteCwd: string;
  piMonoProvider: string;
  piMonoModel: string;
  contextWindow: number;
  maxOutputTokens: number;
  executionContext: ExecutionContext;
}

export interface CanvasThread {
  id: string;
  title: string;
  status: CanvasStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  parentCanvasId?: string;
  parentBranchId?: string;
  summary?: string;
  modelConfigId?: string;
}

export interface Mrp {
  id: string;
  canvasId: string;
  sequence: number;
  userPrompt: string;
  assistantResponse: string;
  title?: string;
  summary?: string;
  status: MrpStatus;
  createdAt: string;
  updatedAt: string;
  modelRunId?: string;
}

export interface CanvasPlacement {
  id: string;
  canvasId: string;
  mrpId: string;
  originCanvasId?: string;
  isExternalReference: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  selectedForContext: boolean;
  connectionHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MrpSection {
  id: string;
  mrpId: string;
  kind: MrpSectionKind;
  title: string;
  summary?: string;
  sequence: number;
  collapsedByDefault: boolean;
  selectable: boolean;
  contextDefault: ContextDefault;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MrpBlock {
  id: string;
  mrpId: string;
  sectionId: string;
  kind: MrpBlockKind;
  sequence: number;
  content: Record<string, unknown>;
  selectable: boolean;
  tokenEstimate?: number;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MrpEvent {
  id: string;
  mrpId: string;
  modelRunId?: string;
  type: string;
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Branch {
  id: string;
  parentCanvasId: string;
  childCanvasId: string;
  sourceMrpIds: string[];
  createdAt: string;
  label?: string;
}

export interface ContextBundle {
  id: string;
  canvasId: string;
  name?: string;
  selectedMrpIds: string[];
  modeByMrpId: Record<string, ContextMode>;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  mrpId: string;
  type: ArtifactType;
  name: string;
  uri: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UploadedAttachment {
  id: string;
  type: Extract<ArtifactType, "image" | "file" | "code">;
  name: string;
  uri: string;
  mimeType?: string;
  size: number;
  textPreview?: string;
  createdAt: string;
}

export interface ModelRun {
  id: string;
  canvasId: string;
  mrpId: string;
  provider: ModelProvider;
  model: string;
  inputMrpIds: string[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  timingMs?: number;
  finishReason?: string;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface TurnTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface FlowuxToolCall {
  id: string;
  name: string;
  args?: unknown;
  status?: "started" | "streaming" | "complete" | "error";
}

export interface FlowuxToolResult {
  toolCallId: string;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
}

export interface FlowuxFileReference {
  path: string;
  action?: "read" | "write" | "edit" | "delete" | "search" | "unknown";
  metadata?: Record<string, unknown>;
}

export type FlowuxTurnEvent =
  | { type: "turn_started"; raw?: unknown }
  | { type: "response_delta"; text: string; raw?: unknown }
  | { type: "thinking_delta"; text: string; raw?: unknown }
  | { type: "tool_call_started"; toolCall: FlowuxToolCall; raw?: unknown }
  | { type: "tool_call_delta"; toolCall: FlowuxToolCall; delta?: unknown; raw?: unknown }
  | { type: "tool_call_completed"; toolCall: FlowuxToolCall; raw?: unknown }
  | { type: "tool_result_delta"; toolResult: FlowuxToolResult; raw?: unknown }
  | { type: "tool_result_completed"; toolResult: FlowuxToolResult; raw?: unknown }
  | { type: "file_referenced"; file: FlowuxFileReference; raw?: unknown }
  | { type: "artifact_created"; artifact: Omit<Artifact, "id" | "mrpId" | "createdAt">; raw?: unknown }
  | { type: "usage"; usage: TurnTokenUsage; raw?: unknown }
  | { type: "raw_event"; eventType: string; raw: unknown }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "done"; finishReason?: string; raw?: unknown };

export interface CanvasSnapshot {
  canvas: CanvasThread;
  mrps: Mrp[];
  placements: CanvasPlacement[];
  modelRuns: ModelRun[];
  sections: MrpSection[];
  blocks: MrpBlock[];
  events: MrpEvent[];
  artifacts: Artifact[];
  branches: Branch[];
  contextBundles: ContextBundle[];
}

export interface MrpDetails {
  mrpId: string;
  modelRuns: ModelRun[];
  sections: MrpSection[];
  blocks: MrpBlock[];
  events: MrpEvent[];
  artifacts: Artifact[];
}

export type SearchResultKind = "canvas" | "mrp" | "artifact";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  canvasId: string;
  mrpId?: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface CreateChildCanvasResponse {
  canvas: CanvasThread;
  branch: Branch;
  placements: CanvasPlacement[];
}

export interface ImportExternalMrpsResponse {
  placements: CanvasPlacement[];
}

export interface CreatePromptRequest {
  canvasId: string;
  prompt: string;
  selectedMrpIds?: string[];
}

export interface CreatePromptResponse {
  mrp: Mrp;
  placement: CanvasPlacement;
  modelRun: ModelRun;
  contextBudget?: ContextBudget;
}

export interface ContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
  mrpId?: string;
}

export interface ContextEstimateResponse {
  canvasId: string;
  prompt: string;
  budget: ContextBudget;
}
