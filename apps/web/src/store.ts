import type { CanvasPlacement, CanvasSnapshot, CreatePromptResponse, Mrp } from "@flowux/shared";
import { create } from "zustand";
import * as api from "./api.js";

const activeCanvasStorageKey = "flowux.activeCanvasId";

interface FlowuxState {
  snapshot?: CanvasSnapshot;
  loading: boolean;
  error?: string;
  loadInitial: () => Promise<void>;
  reloadCanvas: (canvasId: string) => Promise<void>;
  createNewCanvas: () => Promise<void>;
  submitPrompt: (
    prompt: string,
    layout?: api.LayoutRequest,
    onCreated?: (payload: CreatePromptResponse) => void
  ) => Promise<void>;
  patchPlacement: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>;
  snapBack: (layout?: api.LayoutRequest) => Promise<void>;
}

export const useFlowuxStore = create<FlowuxState>((set, get) => ({
  loading: false,

  async loadInitial() {
    set({ loading: true, error: undefined });
    try {
      const canvases = await api.listCanvases();
      const storedCanvasId = window.localStorage.getItem(activeCanvasStorageKey);
      const canvas =
        canvases.find((item) => item.id === storedCanvasId) ?? canvases[0] ?? (await api.createCanvas("Flowux MVP Canvas"));
      const snapshot = await api.getCanvas(canvas.id);
      window.localStorage.setItem(activeCanvasStorageKey, canvas.id);
      set({ snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load Flowux", loading: false });
    }
  },

  async reloadCanvas(canvasId) {
    try {
      const snapshot = await api.getCanvas(canvasId);
      set((state) => {
        if (state.snapshot?.canvas.id !== canvasId) return state;
        window.localStorage.setItem(activeCanvasStorageKey, canvasId);
        return { snapshot, error: undefined };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to reload canvas" });
    }
  },

  async createNewCanvas() {
    set({ loading: true, error: undefined });
    try {
      const canvas = await api.createCanvas("Flowux Canvas");
      const snapshot = await api.getCanvas(canvas.id);
      window.localStorage.setItem(activeCanvasStorageKey, canvas.id);
      set({ snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to create canvas", loading: false });
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
