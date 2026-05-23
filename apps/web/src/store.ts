import type {
  CanvasPlacement,
  CanvasSnapshot,
  CanvasThread,
  CreatePromptResponse,
  ContextBudget,
  ExecutionContext,
  Mrp,
  SearchResult,
  UploadedAttachment
} from "@flowux/shared";
import { create } from "zustand";
import * as api from "./api.js";

const activeCanvasStorageKey = "flowux.activeCanvasId";

interface FlowuxState {
  snapshot?: CanvasSnapshot;
  canvases: CanvasThread[];
  loading: boolean;
  promptRunning: boolean;
  contextBudget?: ContextBudget;
  searchResults: SearchResult[];
  executionContext?: ExecutionContext;
  error?: string;
  loadInitial: () => Promise<void>;
  reloadCanvas: (canvasId: string) => Promise<void>;
  switchCanvas: (canvasId: string) => Promise<void>;
  createNewCanvas: (title?: string) => Promise<void>;
  renameCurrentCanvas: (title: string) => Promise<void>;
  saveCurrentCanvas: () => Promise<void>;
  deleteCurrentCanvas: () => Promise<void>;
  searchWorkspace: (query: string) => Promise<void>;
  refreshContextBudget: (prompt: string, attachments?: UploadedAttachment[]) => Promise<void>;
  loadMrpDetails: (mrpId: string) => Promise<void>;
  createChildCanvasFromSelection: () => Promise<void>;
  importSelectedFromCanvas: (sourceCanvasId: string, layout?: api.LayoutRequest) => Promise<void>;
  saveSelectedContextBundle: (name?: string) => Promise<void>;
  applyContextBundle: (bundleId: string) => Promise<void>;
  deleteContextBundle: (bundleId: string) => Promise<void>;
  submitPrompt: (
    prompt: string,
    layout?: api.LayoutRequest,
    attachments?: UploadedAttachment[],
    onCreated?: (payload: CreatePromptResponse) => void
  ) => Promise<void>;
  cancelActivePrompt: () => Promise<void>;
  patchPlacement: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>;
  setAllContextSelection: (selectedForContext: boolean) => Promise<void>;
  snapBack: (layout?: api.LayoutRequest) => Promise<void>;
}

export const useFlowuxStore = create<FlowuxState>((set, get) => ({
  canvases: [],
  loading: false,
  promptRunning: false,
  searchResults: [],

  async loadInitial() {
    set({ loading: true, error: undefined });
    try {
      const canvases = await api.listCanvases();
      const health = await api.getHealth();
      const storedCanvasId = window.localStorage.getItem(activeCanvasStorageKey);
      const canvas =
        canvases.find((item) => item.id === storedCanvasId) ?? canvases[0] ?? (await api.createCanvas("Flowux MVP Canvas"));
      const nextCanvases = canvases.some((item) => item.id === canvas.id) ? canvases : [canvas, ...canvases];
      const snapshot = await api.getCanvas(canvas.id, { summary: true });
      window.localStorage.setItem(activeCanvasStorageKey, canvas.id);
      set({ canvases: nextCanvases, snapshot, executionContext: health.executionContext, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load Flowux", loading: false });
    }
  },

  async reloadCanvas(canvasId) {
    try {
      const snapshot = await api.getCanvas(canvasId, { summary: true });
      const canvases = await api.listCanvases();
      set((state) => {
        if (state.snapshot?.canvas.id !== canvasId) return state;
        window.localStorage.setItem(activeCanvasStorageKey, canvasId);
        return { canvases, snapshot, error: undefined };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to reload canvas" });
    }
  },

  async switchCanvas(canvasId) {
    set({ loading: true, error: undefined });
    try {
      const snapshot = await api.getCanvas(canvasId, { summary: true });
      const canvases = await api.listCanvases();
      window.localStorage.setItem(activeCanvasStorageKey, canvasId);
      set({ canvases, snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to switch canvas", loading: false });
    }
  },

  async createNewCanvas(title = "Flowux Canvas") {
    set({ loading: true, error: undefined });
    try {
      const canvas = await api.createCanvas(title);
      const snapshot = await api.getCanvas(canvas.id, { summary: true });
      const canvases = await api.listCanvases();
      window.localStorage.setItem(activeCanvasStorageKey, canvas.id);
      set({ canvases, snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to create canvas", loading: false });
    }
  },

  async renameCurrentCanvas(title) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ error: undefined });
    try {
      const canvas = await api.updateCanvasTitle(canvasId, title);
      set((state) => ({
        canvases: state.canvases.map((item) => (item.id === canvas.id ? canvas : item)),
        snapshot: state.snapshot && state.snapshot.canvas.id === canvas.id ? { ...state.snapshot, canvas } : state.snapshot
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to rename canvas" });
    }
  },

  async saveCurrentCanvas() {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ error: undefined });
    try {
      const canvas = await api.updateCanvasStatus(canvasId, "saved");
      set((state) => ({
        canvases: state.canvases.map((item) => (item.id === canvas.id ? canvas : item)),
        snapshot: state.snapshot && state.snapshot.canvas.id === canvas.id ? { ...state.snapshot, canvas } : state.snapshot
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to save canvas" });
    }
  },

  async deleteCurrentCanvas() {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ loading: true, error: undefined });
    try {
      await api.deleteCanvas(canvasId);
      const canvases = await api.listCanvases();
      const nextCanvas = canvases[0] ?? (await api.createCanvas("Flowux Canvas"));
      const nextCanvases = canvases.length ? canvases : [nextCanvas];
      const snapshot = await api.getCanvas(nextCanvas.id, { summary: true });
      window.localStorage.setItem(activeCanvasStorageKey, nextCanvas.id);
      set({ canvases: nextCanvases, snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to delete canvas", loading: false });
    }
  },

  async createChildCanvasFromSelection() {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ loading: true, error: undefined });
    try {
      const child = await api.createChildCanvas(canvasId);
      const snapshot = await api.getCanvas(child.canvas.id, { summary: true });
      const canvases = await api.listCanvases();
      window.localStorage.setItem(activeCanvasStorageKey, child.canvas.id);
      set({ canvases, snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to create child canvas", loading: false });
    }
  },

  async importSelectedFromCanvas(sourceCanvasId, layout = {}) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId || !sourceCanvasId || canvasId === sourceCanvasId) return;
    set({ loading: true, error: undefined });
    try {
      const sourceSnapshot = await api.getCanvas(sourceCanvasId, { summary: true });
      const selectedMrpIds = sourceSnapshot.placements
        .filter((placement) => placement.selectedForContext)
        .map((placement) => placement.mrpId);
      if (!selectedMrpIds.length) {
        set({ error: "Selected MRPs required on source canvas", loading: false });
        return;
      }
      await api.importExternalMrps(canvasId, selectedMrpIds, layout);
      const snapshot = await api.getCanvas(canvasId, { summary: true });
      const canvases = await api.listCanvases();
      set({ canvases, snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to import references", loading: false });
    }
  },

  async saveSelectedContextBundle(name) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ error: undefined });
    try {
      const bundle = await api.saveContextBundle(canvasId, name);
      set((state) => ({
        snapshot: state.snapshot && {
          ...state.snapshot,
          contextBundles: [
            ...state.snapshot.contextBundles.filter((item) => item.id !== bundle.id),
            bundle
          ]
        }
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to save context set" });
    }
  },

  async applyContextBundle(bundleId) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId || !bundleId) return;
    set({ error: undefined });
    try {
      const placements = await api.applyContextBundle(canvasId, bundleId);
      set((state) => ({
        snapshot: state.snapshot && { ...state.snapshot, placements }
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to apply context set" });
    }
  },

  async deleteContextBundle(bundleId) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId || !bundleId) return;
    set({ error: undefined });
    try {
      await api.deleteContextBundle(canvasId, bundleId);
      set((state) => ({
        snapshot: state.snapshot && {
          ...state.snapshot,
          contextBundles: state.snapshot.contextBundles.filter((bundle) => bundle.id !== bundleId)
        }
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to delete context set" });
    }
  },

  async submitPrompt(prompt, layout = {}, attachments = [], onCreated) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;

    set({ promptRunning: true, error: undefined });
    await api.streamPrompt(canvasId, prompt, layout, attachments.map((attachment) => attachment.id), {
      onCreated(payload) {
        onCreated?.(payload);
        set((state) => ({
          contextBudget: payload.contextBudget,
          snapshot:
            state.snapshot?.canvas.id === payload.mrp.canvasId
              ? {
                  ...state.snapshot,
                  mrps: [...state.snapshot.mrps.filter((mrp) => mrp.id !== payload.mrp.id), payload.mrp],
                  modelRuns: [
                    ...state.snapshot.modelRuns.filter((modelRun) => modelRun.id !== payload.modelRun.id),
                    payload.modelRun
                  ],
                  placements: [
                    ...state.snapshot.placements.filter((placement) => placement.id !== payload.placement.id),
                    payload.placement
                  ]
                }
              : state.snapshot
        }));
      },
      onToken(payload) {
        set((state) => ({
          snapshot:
            state.snapshot && state.snapshot.mrps.some((mrp) => mrp.id === payload.mrpId)
              ? {
                  ...state.snapshot,
                  mrps: state.snapshot.mrps.map((mrp) =>
                    mrp.id === payload.mrpId
                      ? { ...mrp, assistantResponse: mrp.assistantResponse + payload.token, status: "streaming" }
                      : mrp
                  )
                }
              : state.snapshot
        }));
      },
      onComplete(payload) {
        set((state) => ({
          promptRunning: false,
          snapshot:
            state.snapshot?.canvas.id === canvasId
              ? {
                  ...state.snapshot,
                  mrps: state.snapshot.mrps.map((mrp) => (mrp.id === payload.mrp.id ? payload.mrp : mrp))
                }
              : state.snapshot
        }));
        void get().reloadCanvas(canvasId);
      },
      onError(message) {
        set({ error: message });
      }
    });
    set({ promptRunning: false });
  },

  async cancelActivePrompt() {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    try {
      await api.cancelPrompt(canvasId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to cancel prompt" });
    }
  },

  async searchWorkspace(query) {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ searchResults: [] });
      return;
    }
    try {
      const response = await api.searchWorkspace(trimmed);
      set({ searchResults: response.results, error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Search failed" });
    }
  },

  async refreshContextBudget(prompt, attachments = []) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    try {
      const response = await api.estimateContext(canvasId, prompt, attachments.map((attachment) => attachment.id));
      set({ contextBudget: response.budget });
    } catch {
      // Budget visibility should never block composing or sending a prompt.
    }
  },

  async loadMrpDetails(mrpId) {
    const canvasId = get().snapshot?.canvas.id;
    const snapshot = get().snapshot;
    if (!canvasId || !snapshot) return;
    if (snapshot.blocks.some((block) => block.mrpId === mrpId) || snapshot.events.some((event) => event.mrpId === mrpId)) return;

    try {
      const details = await api.getMrpDetails(canvasId, mrpId);
      set((state) => {
        if (!state.snapshot || state.snapshot.canvas.id !== canvasId) return state;
        return {
          snapshot: {
            ...state.snapshot,
            modelRuns: mergeById(state.snapshot.modelRuns, details.modelRuns),
            sections: mergeById(state.snapshot.sections, details.sections),
            blocks: mergeById(state.snapshot.blocks, details.blocks),
            events: mergeById(state.snapshot.events, details.events),
            artifacts: mergeById(state.snapshot.artifacts, details.artifacts)
          }
        };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load MRP details" });
    }
  },

  async patchPlacement(mrpId, patch) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;

    set((state) => ({
      snapshot: state.snapshot && {
        ...state.snapshot,
        placements: state.snapshot.placements.map((placement) =>
          placement.mrpId === mrpId ? { ...placement, ...patch } : placement
        )
      }
    }));

    const placement = await api.updatePlacement(canvasId, mrpId, patch);
    set((state) => ({
      snapshot: state.snapshot && {
        ...state.snapshot,
        placements: state.snapshot.placements.map((item) => (item.id === placement.id ? placement : item))
      }
    }));
  },

  async setAllContextSelection(selectedForContext) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ error: undefined });
    try {
      const placements = await api.updateCanvasSelection(canvasId, selectedForContext);
      set((state) => ({
        snapshot: state.snapshot && { ...state.snapshot, placements }
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to update context selection" });
    }
  },

  async snapBack(layout) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    const placements = await api.snapBack(canvasId, layout);
    set((state) => ({
      snapshot: state.snapshot && { ...state.snapshot, placements }
    }));
  }
}));

function mergeById<T extends { id: string }>(current: T[], next: T[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of next) byId.set(item.id, item);
  return Array.from(byId.values());
}

export function findPlacement(snapshot: CanvasSnapshot, mrp: Mrp) {
  return snapshot.placements.find((placement) => placement.mrpId === mrp.id);
}
