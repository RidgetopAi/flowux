import type { CanvasPlacement, CanvasSnapshot, CanvasThread, CreatePromptResponse, Mrp } from "@flowux/shared";
import { create } from "zustand";
import * as api from "./api.js";

const activeCanvasStorageKey = "flowux.activeCanvasId";

interface FlowuxState {
  snapshot?: CanvasSnapshot;
  canvases: CanvasThread[];
  loading: boolean;
  error?: string;
  loadInitial: () => Promise<void>;
  reloadCanvas: (canvasId: string) => Promise<void>;
  switchCanvas: (canvasId: string) => Promise<void>;
  createNewCanvas: (title?: string) => Promise<void>;
  renameCurrentCanvas: (title: string) => Promise<void>;
  deleteCurrentCanvas: () => Promise<void>;
  createChildCanvasFromSelection: () => Promise<void>;
  importSelectedFromCanvas: (sourceCanvasId: string, layout?: api.LayoutRequest) => Promise<void>;
  saveSelectedContextBundle: (name?: string) => Promise<void>;
  applyContextBundle: (bundleId: string) => Promise<void>;
  deleteContextBundle: (bundleId: string) => Promise<void>;
  submitPrompt: (
    prompt: string,
    layout?: api.LayoutRequest,
    onCreated?: (payload: CreatePromptResponse) => void
  ) => Promise<void>;
  patchPlacement: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>;
  setAllContextSelection: (selectedForContext: boolean) => Promise<void>;
  snapBack: (layout?: api.LayoutRequest) => Promise<void>;
}

export const useFlowuxStore = create<FlowuxState>((set, get) => ({
  canvases: [],
  loading: false,

  async loadInitial() {
    set({ loading: true, error: undefined });
    try {
      const canvases = await api.listCanvases();
      const storedCanvasId = window.localStorage.getItem(activeCanvasStorageKey);
      const canvas =
        canvases.find((item) => item.id === storedCanvasId) ?? canvases[0] ?? (await api.createCanvas("Flowux MVP Canvas"));
      const nextCanvases = canvases.some((item) => item.id === canvas.id) ? canvases : [canvas, ...canvases];
      const snapshot = await api.getCanvas(canvas.id);
      window.localStorage.setItem(activeCanvasStorageKey, canvas.id);
      set({ canvases: nextCanvases, snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load Flowux", loading: false });
    }
  },

  async reloadCanvas(canvasId) {
    try {
      const snapshot = await api.getCanvas(canvasId);
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
      const snapshot = await api.getCanvas(canvasId);
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
      const snapshot = await api.getCanvas(canvas.id);
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

  async deleteCurrentCanvas() {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    set({ loading: true, error: undefined });
    try {
      await api.deleteCanvas(canvasId);
      const canvases = await api.listCanvases();
      const nextCanvas = canvases[0] ?? (await api.createCanvas("Flowux Canvas"));
      const nextCanvases = canvases.length ? canvases : [nextCanvas];
      const snapshot = await api.getCanvas(nextCanvas.id);
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
      const snapshot = await api.getCanvas(child.canvas.id);
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
      const sourceSnapshot = await api.getCanvas(sourceCanvasId);
      const selectedMrpIds = sourceSnapshot.placements
        .filter((placement) => placement.selectedForContext)
        .map((placement) => placement.mrpId);
      if (!selectedMrpIds.length) {
        set({ error: "Selected MRPs required on source canvas", loading: false });
        return;
      }
      await api.importExternalMrps(canvasId, selectedMrpIds, layout);
      const snapshot = await api.getCanvas(canvasId);
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

  async submitPrompt(prompt, layout = {}, onCreated) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;

    await api.streamPrompt(canvasId, prompt, layout, {
      onCreated(payload) {
        onCreated?.(payload);
        set((state) => ({
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

export function findPlacement(snapshot: CanvasSnapshot, mrp: Mrp) {
  return snapshot.placements.find((placement) => placement.mrpId === mrp.id);
}
