import type { CanvasPlacement, CanvasSnapshot, Mrp } from "@flowux/shared";
import { create } from "zustand";
import * as api from "./api.js";

interface FlowuxState {
  snapshot?: CanvasSnapshot;
  loading: boolean;
  error?: string;
  loadInitial: () => Promise<void>;
  submitPrompt: (prompt: string) => Promise<void>;
  patchPlacement: (mrpId: string, patch: Partial<CanvasPlacement>) => Promise<void>;
  snapBack: () => Promise<void>;
}

export const useFlowuxStore = create<FlowuxState>((set, get) => ({
  loading: false,

  async loadInitial() {
    set({ loading: true, error: undefined });
    try {
      const canvases = await api.listCanvases();
      const canvas = canvases[0] ?? (await api.createCanvas("Flowux MVP Canvas"));
      const snapshot = await api.getCanvas(canvas.id);
      set({ snapshot, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load Flowux", loading: false });
    }
  },

  async submitPrompt(prompt: string) {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;

    await api.streamPrompt(canvasId, prompt, {
      onCreated(payload) {
        set((state) => ({
          snapshot: state.snapshot && {
            ...state.snapshot,
            mrps: [...state.snapshot.mrps, payload.mrp],
            placements: [...state.snapshot.placements, payload.placement]
          }
        }));
      },
      onToken(payload) {
        set((state) => ({
          snapshot: state.snapshot && {
            ...state.snapshot,
            mrps: state.snapshot.mrps.map((mrp) =>
              mrp.id === payload.mrpId
                ? { ...mrp, assistantResponse: mrp.assistantResponse + payload.token, status: "streaming" }
                : mrp
            )
          }
        }));
      },
      onComplete() {
        void get().loadInitial();
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

  async snapBack() {
    const canvasId = get().snapshot?.canvas.id;
    if (!canvasId) return;
    const placements = await api.snapBack(canvasId);
    set((state) => ({
      snapshot: state.snapshot && { ...state.snapshot, placements }
    }));
  }
}));

export function findPlacement(snapshot: CanvasSnapshot, mrp: Mrp) {
  return snapshot.placements.find((placement) => placement.mrpId === mrp.id);
}

