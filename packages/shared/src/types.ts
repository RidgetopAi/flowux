export type CanvasStatus = "temporary" | "saved" | "archived";
export type MrpStatus = "pending" | "streaming" | "complete" | "error";
export type ContextMode = "full_mrp" | "summary" | "response_only" | "excerpt" | "none";
export type ArtifactType = "image" | "file" | "code" | "link" | "diff" | "terminal";
export type ModelProvider = "mock" | "llama_cpp" | "openai_compatible";

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

export interface ModelRun {
  id: string;
  canvasId: string;
  mrpId: string;
  provider: ModelProvider;
  model: string;
  inputMrpIds: string[];
  promptTokens?: number;
  completionTokens?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface CanvasSnapshot {
  canvas: CanvasThread;
  mrps: Mrp[];
  placements: CanvasPlacement[];
  branches: Branch[];
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
}

export interface ContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
  mrpId?: string;
}

