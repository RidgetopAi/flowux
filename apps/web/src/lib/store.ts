import type { CanvasSnapshot } from "@flowux/shared";
import { create } from "zustand";
import { snapshotToCanvasObjects } from "./canvasAdapter";
import { arrangeGrid, nextGridSlot } from "./layout";

/** External hook for sending a prompt + staged attachments. When set on
 *  the store (e.g. by App.tsx after wiring apps/api), FloatingDock's
 *  send button calls this instead of the mock addMRP. Must return a
 *  synchronous id used for image anchor chaining and immediate
 *  setExpanded/revealMRP — the handler is free to kick off async work
 *  (POST stream, SSE, snapshot reload) in the background. */
export type SubmitPromptHandler = (input: {
  prompt: string;
  attachments: DockAttachment[];
}) => string;

/** External hook for persisting object position changes (drag-end,
 *  arrangeAll). Fires once per moved object with the new world coords;
 *  the handler is responsible for translating CanvasObject.id back to
 *  whatever the backend keys placements on (e.g. mrpId). Fire-and-forget
 *  — failures should be handled by the handler, not propagated. */
export type MovePersistHandler = (objectId: string, x: number, y: number) => void;

/** Called when the user clicks a fork button on an MRP card (or bundle).
 *  Receives the CanvasObject ids that should seed the new child canvas.
 *  Real apps wire this to a backend-driven branch creation; playground/
 *  mock stores can no-op or log. */
export type ForkHandler = (sourceObjectIds: string[]) => void;

export type MRPStatus = "idle" | "pending" | "active" | "complete" | "error";

/** Directions the keyboard cursor can move on the canvas.
 *  Arrows = spatial (cone-based nearest neighbor, no wrap) — work across
 *  any object variant.
 *  next/prev = sequence-order cycle (with wrap) — MRP-only since
 *  sequence is the canonical thread order and only MRPs have it.
 *  first/last = jumps to the first/last MRP in sequence order. */
export type CursorDirection =
  | "up" | "down" | "left" | "right"
  | "next" | "prev"
  | "first" | "last";

/* ── Object model ──────────────────────────────────────────────────────────
   Every canvas object shares a base shape: id, position, size, and bundle
   membership. Variants layer their own data on top.

   Generic actions (move, toggle-check, drag, cursor-arrow nav, layout) all
   work against the base. Variant-specific actions (addMRP, patchMRP,
   sequence-based nav) live alongside.

   Image is a structural stub today — no renderer yet, just proves the
   union actually flexes across types. The next phase wires paste/drop UX. */

export type ObjectBase = {
  id: string;
  /** Canvas-space position (top-left of the tile). */
  x: number;
  y: number;
  /** Tile footprint on the canvas. The expanded view doesn't use these —
   *  only the on-canvas presence. */
  width: number;
  height: number;
  /** Included in the context bundle for the next prompt. The selection
   *  IS the bundle — one state, multiple input paths. */
  checked: boolean;
};

export type MRPObject = ObjectBase & {
  type: "mrp";
  /** Canonical thread order — independent of canvas placement. What the
   *  model sees when this MRP's bundle is composed. */
  sequence: number;
  status: MRPStatus;
  prompt: string;
  response: string;
  model: string;
  tokens: number;
  /** ISO timestamp string. */
  timestamp: string;
  /** From another thread — gets the violet treatment. */
  external?: boolean;
  /** ID of the MRP this branched from. */
  parentId?: string;
  /** Number of child canvases this MRP seeded. 0/undefined when this card
   *  has never been used as a fork source. Renders as a small badge. */
  branchOutCount?: number;
};

export type ImageObject = ObjectBase & {
  type: "image";
  src: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** Optional anchor to an MRP — semantically "attached to this prompt".
   *  Different from MRP.parentId (which is "branched from"). */
  anchoredToId?: string;
};

/** Per-tool-call canvas node. Rendered as a thin chip stacked below the
 *  issuing MRP. Surfaces tool name + summarized args + status; clicking
 *  expands its parent MRP. NOT selectable (excluded from bundle math). */
export type ToolCallStatus = "started" | "streaming" | "complete" | "error";

export type ToolCallObject = ObjectBase & {
  type: "tool_call";
  /** Lowercase tool name as reported by the model harness (e.g. "smart_search",
   *  "Read", "Bash"). Used for both display and per-tool chrome. */
  name: string;
  /** One-line argument summary (e.g. file path, query text). */
  argsSummary?: string;
  status: ToolCallStatus;
  /** The MRP placement.id this tool call belongs to. Used for anchoring +
   *  for click→expand to land on the right card. */
  anchoredToId: string;
};

/** Discriminated union — every canvas object is one of these variants. */
export type CanvasObject = MRPObject | ImageObject | ToolCallObject;

/** An image staged in the dock awaiting send. Holds enough to (a) render
 *  a thumbnail preview in the dock and (b) materialize an ImageObject
 *  when send fires, anchored to the new MRP. NOT a canvas object — only
 *  becomes one on send. */
export type DockAttachment = {
  src: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
};

/** Backwards-compat alias. Component code that's specifically about the
 *  MRP variant imports { MRP } and gets MRPObject — saves a rename across
 *  every consumer for a refactor that doesn't change MRP semantics. */
export type MRP = MRPObject;

/** Type-narrowing filter for selectors that want just MRPs (e.g.
 *  ConnectionLayer uses parentId, dock send creates an MRP). */
export function filterMRPs(objects: ReadonlyArray<CanvasObject>): MRPObject[] {
  return objects.filter((o): o is MRPObject => o.type === "mrp");
}

/** Sidebar tab identifiers — duplicated in Sidebar.tsx as a local type
 *  union but lifted here so slash commands and other store consumers
 *  can drive sidebar state. */
export type SidebarTab = "search" | "bundles" | "branches" | "imports" | "history";

export type Viewport = {
  pan: { x: number; y: number };
  /** Scale factor applied to the inner canvas layer.
   *  1.0 = real size. Clamped to [ZOOM_MIN, ZOOM_MAX] by the actions. */
  zoom: number;
  /** Outer canvas dimensions in CSS pixels — kept current by the Canvas
   *  component's ResizeObserver. Width drives grid layout, both dims are
   *  used by revealMRP for visibility math. */
  width: number;
  height: number;
  /** Canvas surface position in VIEWPORT (window) pixels. The locked
   *  dock uses these to convert world coords → fixed left/top. */
  left: number;
  top: number;
};

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.0;

/** Canvas tile defaults for the MRP variant. Image tiles fit inside the
 *  same envelope but scale by their natural aspect ratio. */
const MRP_DEFAULT_WIDTH = 320;
const MRP_DEFAULT_HEIGHT = 240;
/** Max envelope an image tile fits within. Preserves aspect ratio. */
const IMG_MAX_WIDTH = 320;
const IMG_MAX_HEIGHT = 240;
/** Horizontal gap when anchoring an image to the right of its parent MRP. */
const IMG_ANCHOR_GAP = 24;

/** Fit (nw × nh) inside (maxW × maxH) preserving aspect ratio. Returns the
 *  contained dimensions. If natural dims are missing, falls back to the
 *  full envelope (image will stretch via object-fit: contain in CSS). */
function fitInside(
  nw: number | undefined,
  nh: number | undefined,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  if (!nw || !nh) return { width: maxW, height: maxH };
  const scale = Math.min(maxW / nw, maxH / nh, 1);
  return { width: Math.round(nw * scale), height: Math.round(nh * scale) };
}

type State = {
  objects: CanvasObject[];
  viewport: Viewport;
  expandedId: string | null;
  draggingId: string | null;
  /** Keyboard cursor — the object receiving keyboard intent. Any variant
   *  can hold the cursor; sequence-based nav (Tab) cycles MRPs only. */
  cursorId: string | null;
  /** Floating compose dock state. Position is viewport-relative; null
   *  means "use the default (bottom-center)" so the layout can recompute
   *  on resize. dockDraft persists across close/reopen. */
  dockOpen: boolean;
  dockPosition: { x: number; y: number } | null;
  dockDraft: string;
  /** Sent prompts in chronological order (oldest → newest). The dock's
   *  textarea walks this with Up/Down when the caret is at the start/end. */
  promptHistory: string[];
  /** When non-null, the dock is locked to a point in canvas WORLD coords.
   *  Pan/zoom re-position the dock accordingly; size stays constant. */
  dockLockAnchor: { x: number; y: number } | null;
  /** Images staged in the dock awaiting send. Materialized into
   *  ImageObjects (anchored to the new MRP) when send fires. */
  dockAttachments: DockAttachment[];
  /** Sidebar UI state lifted to the store so slash commands (`/find`,
   *  `/history`) can drive the sidebar from inside the dock. Sidebar
   *  component reads these on render. */
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  /** Optional one-shot focus signal — bumped when a command wants the
   *  search input to grab keyboard focus the next time SearchPanel
   *  renders. Treated as a tick (any change → focus once). */
  sidebarFocusTick: number;

  // Selectors
  bundleCount: () => number;

  // Actions — object-agnostic (work on any CanvasObject variant)
  moveObject: (id: string, x: number, y: number) => void;
  /** Toggle the object's bundle inclusion. Selection IS the bundle —
   *  manual checkbox click, Space on cursor, Cmd+A all feed this set. */
  toggleCheck: (id: string) => void;
  /** Add every object to the bundle (Cmd/Ctrl+A). */
  checkAll: () => void;
  /** Clear the bundle — bound to Esc as the fast "reset working set" gesture. */
  clearBundle: () => void;
  /** Set checked=true for every object whose world-coord bbox intersects
   *  the given rectangle. Drives rubber-band drag-select. Rectangle is
   *  given in world (canvas-layer) coords; bounds are normalized so the
   *  caller doesn't have to track drag direction. */
  checkInRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  removeObject: (id: string) => void;

  // Actions — MRP-specific
  /** Create an MRP and append it to the canvas. */
  addMRP: (mrp?: Partial<MRPObject>) => string;
  /** Patch an existing MRP's fields — used by the dock send flow to fill
   *  in the response after a "thinking" beat. No-op for non-MRP ids. */
  patchMRP: (id: string, patch: Partial<MRPObject>) => void;
  /** Pan the viewport so the given MRP is centered in the visible canvas
   *  region (above the dock if it's open). No-op when already fully visible. */
  revealMRP: (id: string) => void;

  // Actions — Image-specific
  /** Create an ImageObject. By default it anchors to the most recent MRP
   *  (right side + 24px gap, sized to fit the canvas tile envelope).
   *  Pass explicit `x`/`y` (e.g. from drop coords) to override placement;
   *  pass `anchoredToId: null` to skip the MRP anchor.
   *  Returns the new object's id. */
  addImage: (input: {
    src: string;
    alt?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    x?: number;
    y?: number;
    anchoredToId?: string | null;
  }) => string;

  // Overlay + dock state
  setExpanded: (id: string | null) => void;
  /** Optional query string highlighted inside the expanded MRP overlay
   *  when it was opened from a search result. Cleared when the overlay
   *  closes. null = no highlight (default reading mode). */
  expandedHighlight: string | null;
  setExpandedHighlight: (query: string | null) => void;
  setDragging: (id: string | null) => void;
  setCursor: (id: string | null) => void;
  openDock: () => void;
  closeDock: () => void;
  setDockPosition: (pos: { x: number; y: number } | null) => void;
  setDockDraft: (text: string) => void;
  /** Append a sent prompt to history. Dedupes against the immediate previous
   *  entry so spamming the same prompt doesn't bloat the list. */
  pushPromptHistory: (text: string) => void;
  /** Flip the dock's lock state. Locking captures the dock's current
   *  on-screen top-left as a world-coord anchor; unlocking writes the
   *  current visible position back into dockPosition. */
  toggleDockLock: (currentDockTopLeft: { x: number; y: number }) => void;
  setDockLockAnchor: (anchor: { x: number; y: number }) => void;
  /** Stage an image for inclusion with the next send. Dedupes by src
   *  so the same paste twice doesn't queue twice. */
  addDockAttachment: (attachment: DockAttachment) => void;
  removeDockAttachment: (index: number) => void;
  clearDockAttachments: () => void;
  /** Sidebar control — also auto-opens the sidebar when a tab is set
   *  so `/find` and `/history` work whether the sidebar is collapsed
   *  or not. */
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarOpen: (open: boolean) => void;
  /** Bump sidebarFocusTick. Use after setSidebarTab('search') to also
   *  focus the search input. */
  focusSidebarSearch: () => void;

  // Cursor + pan + zoom
  moveCursor: (direction: CursorDirection, extend?: boolean) => void;
  setPan: (x: number, y: number) => void;
  panBy: (dx: number, dy: number) => void;
  resetPan: () => void;
  setZoom: (z: number, anchor?: { x: number; y: number }) => void;
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  resetView: () => void;
  /** Pan + zoom so every object's bbox fits inside the viewport with a
   *  small margin. No-op when the canvas is empty. Zoom is clamped to
   *  [ZOOM_MIN, ZOOM_MAX] — for tiny single-card canvases the camera
   *  ceiling kicks in (we don't zoom further than 2×). */
  zoomToFit: () => void;

  // Layout
  loadFixtures: (objects: CanvasObject[]) => void;
  /** Hydrate the canvas from a real apps/api CanvasSnapshot. Replaces the
   *  objects array via the snapshot adapter. Unlike loadFixtures, does
   *  NOT re-flow into a grid — persisted placements come with x/y. */
  loadFromSnapshot: (snapshot: CanvasSnapshot) => void;
  arrangeAll: () => void;
  setViewportRect: (left: number, top: number, width: number, height: number) => void;

  // External integration hooks
  submitPromptHandler: SubmitPromptHandler | null;
  setSubmitPromptHandler: (handler: SubmitPromptHandler | null) => void;
  movePersistHandler: MovePersistHandler | null;
  setMovePersistHandler: (handler: MovePersistHandler | null) => void;
  forkHandler: ForkHandler | null;
  setForkHandler: (handler: ForkHandler | null) => void;
};

let seq = 0;
const nextId = (prefix = "obj") =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const useCanvas = create<State>((set, get) => ({
  objects: [],
  viewport: { pan: { x: 0, y: 0 }, zoom: 1, width: 1280, height: 800, left: 0, top: 0 },
  expandedId: null,
  draggingId: null,
  cursorId: null,
  dockOpen: false,
  dockPosition: null,
  dockDraft: "",
  promptHistory: [],
  dockLockAnchor: null,
  dockAttachments: [],
  expandedHighlight: null,
  sidebarOpen: true,
  sidebarTab: "search",
  sidebarFocusTick: 0,

  bundleCount: () => get().objects.filter((o) => o.checked).length,

  addMRP: (mrp = {}) => {
    const id = mrp.id ?? nextId("mrp");
    const state = get();
    const existingMRPs = filterMRPs(state.objects);
    const sequence = mrp.sequence ?? existingMRPs.length + 1;
    // Caller-pinned coords win; otherwise snap to the next grid slot.
    // nextGridSlot anchors at the existing top row Y so new cards extend
    // downward without overlapping the centered initial layout.
    const slot =
      mrp.x !== undefined && mrp.y !== undefined
        ? { x: mrp.x, y: mrp.y }
        : nextGridSlot(state.objects.length, state.viewport.width, state.objects);
    const full: MRPObject = {
      type: "mrp",
      id,
      sequence,
      x: slot.x,
      y: slot.y,
      width: mrp.width ?? MRP_DEFAULT_WIDTH,
      height: mrp.height ?? MRP_DEFAULT_HEIGHT,
      status: mrp.status ?? "complete",
      prompt: mrp.prompt ?? "Untitled prompt",
      response: mrp.response ?? "",
      model: mrp.model ?? "opus-4.7",
      tokens: mrp.tokens ?? 0,
      timestamp: mrp.timestamp ?? new Date().toISOString(),
      checked: mrp.checked ?? false,
      external: mrp.external,
      parentId: mrp.parentId,
    };
    set((s) => ({ objects: [...s.objects, full] }));
    return id;
  },

  addImage: (input) => {
    const id = nextId("img");
    const state = get();
    const { width, height } = fitInside(
      input.naturalWidth,
      input.naturalHeight,
      IMG_MAX_WIDTH,
      IMG_MAX_HEIGHT,
    );

    // Resolve anchor + placement.
    //   - explicit x/y wins (e.g. drop coords)
    //   - else anchor to the most recent MRP if available (right + gap)
    //   - else center the image on the canvas origin
    let x: number;
    let y: number;
    let anchoredToId: string | undefined;

    if (input.x !== undefined && input.y !== undefined) {
      x = input.x;
      y = input.y;
      anchoredToId = input.anchoredToId ?? undefined;
    } else {
      // anchoredToId === null explicitly skips MRP anchor; undefined = default
      const mrps = filterMRPs(state.objects);
      const anchorMRP =
        input.anchoredToId === null
          ? undefined
          : input.anchoredToId
            ? mrps.find((m) => m.id === input.anchoredToId)
            : mrps.length > 0
              ? mrps.reduce((latest, m) =>
                  m.sequence > latest.sequence ? m : latest,
                )
              : undefined;
      if (anchorMRP) {
        x = anchorMRP.x + anchorMRP.width + IMG_ANCHOR_GAP;
        // Vertical center-align with the anchor MRP.
        y = anchorMRP.y + (anchorMRP.height - height) / 2;
        anchoredToId = anchorMRP.id;
      } else {
        // No anchor → land at the current viewport's visual center so the
        // image is immediately visible regardless of how far the user has
        // panned. World point at viewport center = -pan / zoom (since
        // viewport center maps to layer origin + pan = world 0,0 + pan).
        const { pan, zoom } = state.viewport;
        const centerX = -pan.x / zoom;
        const centerY = -pan.y / zoom;
        x = centerX - width / 2;
        y = centerY - height / 2;
      }
    }

    const full: ImageObject = {
      type: "image",
      id,
      x,
      y,
      width,
      height,
      checked: false,
      src: input.src,
      alt: input.alt,
      naturalWidth: input.naturalWidth,
      naturalHeight: input.naturalHeight,
      anchoredToId,
    };
    set((s) => ({ objects: [...s.objects, full] }));
    return id;
  },

  moveObject: (id, x, y) => {
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, x, y } : o)),
    }));
    get().movePersistHandler?.(id, x, y);
  },

  toggleCheck: (id) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, checked: !o.checked } : o,
      ),
    })),

  checkAll: () =>
    set((s) => ({
      objects: s.objects.map((o) => (o.checked ? o : { ...o, checked: true })),
    })),

  clearBundle: () =>
    set((s) => ({
      objects: s.objects.map((o) => (o.checked ? { ...o, checked: false } : o)),
    })),

  checkInRect: (rect) => {
    // Normalize so width/height can be passed negative (rubber-band drag in
    // any direction). Use AABB overlap, not center-in-rect, so a brush over
    // an object's edge still picks it up.
    const minX = Math.min(rect.x, rect.x + rect.width);
    const maxX = Math.max(rect.x, rect.x + rect.width);
    const minY = Math.min(rect.y, rect.y + rect.height);
    const maxY = Math.max(rect.y, rect.y + rect.height);
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.checked) return o;
        const ox1 = o.x;
        const oy1 = o.y;
        const ox2 = o.x + o.width;
        const oy2 = o.y + o.height;
        const intersects = ox2 >= minX && ox1 <= maxX && oy2 >= minY && oy1 <= maxY;
        return intersects ? { ...o, checked: true } : o;
      }),
    }));
  },

  removeObject: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      expandedId: s.expandedId === id ? null : s.expandedId,
      cursorId: s.cursorId === id ? null : s.cursorId,
    })),

  setExpanded: (id) =>
    // Clear any sticky search highlight when the overlay closes so the next
    // unrelated expand (click on a card, not a search result) doesn't show
    // stale marks.
    set((s) => ({
      expandedId: id,
      expandedHighlight: id === null ? null : s.expandedHighlight,
    })),
  setExpandedHighlight: (query) => set({ expandedHighlight: query?.trim() || null }),
  setDragging: (id) => set({ draggingId: id }),
  setCursor: (id) => set({ cursorId: id }),
  setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  focusSidebarSearch: () =>
    set((s) => ({
      sidebarTab: "search",
      sidebarOpen: true,
      sidebarFocusTick: s.sidebarFocusTick + 1,
    })),

  openDock: () => set({ dockOpen: true }),
  closeDock: () => set({ dockOpen: false }),
  setDockPosition: (pos) => set({ dockPosition: pos }),
  setDockDraft: (text) => set({ dockDraft: text }),
  pushPromptHistory: (text) =>
    set((s) => {
      const trimmed = text.trim();
      if (!trimmed) return {};
      const last = s.promptHistory[s.promptHistory.length - 1];
      if (last === trimmed) return {};
      return { promptHistory: [...s.promptHistory, trimmed] };
    }),

  toggleDockLock: (topLeft) => {
    const state = get();
    const { width, height, left, top, pan, zoom } = state.viewport;
    if (state.dockLockAnchor) {
      // UNLOCK: write the dock's current visible position back to dockPosition.
      const screenX =
        left + width / 2 + pan.x + state.dockLockAnchor.x * zoom;
      const screenY =
        top + height / 2 + pan.y + state.dockLockAnchor.y * zoom;
      set({
        dockLockAnchor: null,
        dockPosition: { x: screenX, y: screenY },
      });
    } else {
      // LOCK: capture current dock viewport top-left → world coords.
      //   world = (viewport - canvasTL - viewportCenter - pan) / zoom
      const worldX = (topLeft.x - left - width / 2 - pan.x) / zoom;
      const worldY = (topLeft.y - top - height / 2 - pan.y) / zoom;
      set({ dockLockAnchor: { x: worldX, y: worldY } });
    }
  },

  setDockLockAnchor: (anchor) => set({ dockLockAnchor: anchor }),

  addDockAttachment: (attachment) =>
    set((s) => {
      // Skip if the same src is already staged — paste-twice shouldn't queue twice.
      if (s.dockAttachments.some((a) => a.src === attachment.src)) return {};
      return { dockAttachments: [...s.dockAttachments, attachment] };
    }),

  removeDockAttachment: (index) =>
    set((s) => ({
      dockAttachments: s.dockAttachments.filter((_, i) => i !== index),
    })),

  clearDockAttachments: () => set({ dockAttachments: [] }),

  patchMRP: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id && o.type === "mrp" ? { ...o, ...patch } : o,
      ),
    })),

  moveCursor: (direction, extend = false) => {
    const { objects, cursorId } = get();
    if (objects.length === 0) return;

    const isSequenceNav =
      direction === "first" ||
      direction === "last" ||
      direction === "next" ||
      direction === "prev";

    const before = cursorId;

    // Entry case: no cursor → seed.
    //   Sequence nav lands on the first/last MRP by sequence.
    //   Spatial nav also seeds via sequence order (matches prior behavior),
    //   so the first arrow press lands on a deterministic starting card.
    if (!cursorId) {
      const mrps = filterMRPs(objects);
      if (mrps.length === 0) return;
      const ord = sequenceOrder(mrps);
      const backward =
        direction === "last" ||
        direction === "prev" ||
        direction === "up" ||
        direction === "left";
      const edge = backward ? ord[ord.length - 1] : ord[0];
      if (edge) set({ cursorId: edge.id });
    } else {
      const current = objects.find((o) => o.id === cursorId);
      if (!current) {
        // Cursor pointing at a removed object — reset to first MRP if any,
        // else first object (deterministic fallback).
        const mrps = filterMRPs(objects);
        const fallback = mrps[0] ?? objects[0];
        set({ cursorId: fallback?.id ?? null });
      } else if (isSequenceNav) {
        // Sequence nav is MRP-only since sequence is an MRP field. If the
        // cursor is currently on a non-MRP, walk into the MRP list at the
        // edge appropriate to the direction.
        const mrps = filterMRPs(objects);
        if (mrps.length === 0) return;
        const ord = sequenceOrder(mrps);
        if (direction === "first") {
          const first = ord[0];
          if (first) set({ cursorId: first.id });
        } else if (direction === "last") {
          const last = ord[ord.length - 1];
          if (last) set({ cursorId: last.id });
        } else {
          const idx =
            current.type === "mrp"
              ? ord.findIndex((m) => m.id === current.id)
              : -1;
          const startIdx = idx >= 0 ? idx : direction === "next" ? -1 : 0;
          const delta = direction === "next" ? 1 : -1;
          const nextIdx = (startIdx + delta + ord.length) % ord.length;
          const target = ord[nextIdx];
          if (target) set({ cursorId: target.id });
        }
      } else {
        // Spatial arrow — cone-based nearest neighbor across any object type.
        const neighbor = findSpatialNeighbor(current, objects, direction);
        if (neighbor) set({ cursorId: neighbor.id });
        // else: no candidate in that direction — cursor stays put.
      }
    }

    // Shift+Arrow grow: add source + destination to the bundle. Works
    // across any object type — bundle = selection = the working set.
    if (extend) {
      const after = get().cursorId;
      set((s) => {
        const toCheck = new Set<string>();
        if (before) toCheck.add(before);
        if (after) toCheck.add(after);
        const needsUpdate = s.objects.some(
          (o) => toCheck.has(o.id) && !o.checked,
        );
        if (!needsUpdate) return {};
        return {
          objects: s.objects.map((o) =>
            toCheck.has(o.id) && !o.checked ? { ...o, checked: true } : o,
          ),
        };
      });
    }
  },

  setPan: (x, y) =>
    set((s) => ({ viewport: { ...s.viewport, pan: { x, y } } })),
  panBy: (dx, dy) =>
    set((s) => ({
      viewport: {
        ...s.viewport,
        pan: { x: s.viewport.pan.x + dx, y: s.viewport.pan.y + dy },
      },
    })),
  resetPan: () =>
    set((s) => ({ viewport: { ...s.viewport, pan: { x: 0, y: 0 } } })),

  setZoom: (z, anchor) =>
    set((s) => {
      const zNext = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
      const zPrev = s.viewport.zoom;
      if (zNext === zPrev) return {};
      // Layer origin (world 0,0) sits at canvas-center + pan in screen px.
      // To keep the world point under `anchor` fixed when zoom changes:
      //   pan' = anchor - (anchor - pan) * (zNext / zPrev)
      // No anchor collapses to (0,0) — the current visual center stays put.
      const ax = anchor?.x ?? 0;
      const ay = anchor?.y ?? 0;
      const k = zNext / zPrev;
      const panX = ax - (ax - s.viewport.pan.x) * k;
      const panY = ay - (ay - s.viewport.pan.y) * k;
      return {
        viewport: { ...s.viewport, zoom: zNext, pan: { x: panX, y: panY } },
      };
    }),

  zoomBy: (factor, anchor) => {
    const z = get().viewport.zoom * factor;
    get().setZoom(z, anchor);
  },

  resetView: () =>
    set((s) => ({
      viewport: { ...s.viewport, pan: { x: 0, y: 0 }, zoom: 1 },
    })),

  zoomToFit: () => {
    const s = get();
    if (s.objects.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of s.objects) {
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (o.x + o.width > maxX) maxX = o.x + o.width;
      if (o.y + o.height > maxY) maxY = o.y + o.height;
    }

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // 80px viewport margin total (40 each side) keeps cards from kissing
    // the edge — leaves room for HUD chips + chrome.
    const vw = Math.max(100, s.viewport.width - 80);
    const vh = Math.max(100, s.viewport.height - 80);
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(vw / bboxW, vh / bboxH)));

    // Place bbox center at world (0,0)-equivalent screen point (the
    // viewport center). pan = -bboxCenter * zoom.
    set((s2) => ({
      viewport: {
        ...s2.viewport,
        zoom: z,
        pan: { x: -cx * z, y: -cy * z },
      },
    }));
  },

  loadFixtures: (objects) => {
    // Re-flow seed objects into the auto-grid before loading. The mock
    // data's hardcoded x/y get overridden so the initial state always
    // reads as a clean organized stack.
    const width = get().viewport.width;
    const positions = arrangeGrid({ count: objects.length, viewportWidth: width });
    const arranged = objects.map((o, i) => ({
      ...o,
      x: positions[i]?.x ?? o.x,
      y: positions[i]?.y ?? o.y,
    }));
    set({ objects: arranged, expandedId: null, cursorId: null });
  },

  loadFromSnapshot: (snapshot) => {
    const next = snapshotToCanvasObjects(snapshot);
    // Preserve UI-only state across snapshot refreshes; only swap objects.
    set((s) => ({
      objects: next,
      // If the expanded MRP is no longer in the snapshot, drop the overlay.
      expandedId: s.expandedId && next.some((o) => o.id === s.expandedId) ? s.expandedId : null,
      cursorId: s.cursorId && next.some((o) => o.id === s.cursorId) ? s.cursorId : null,
    }));
  },

  arrangeAll: () => {
    const state = get();
    const positions = arrangeGrid({
      count: state.objects.length,
      viewportWidth: state.viewport.width,
    });
    const arranged = state.objects.map((o, i) => ({
      ...o,
      x: positions[i]?.x ?? o.x,
      y: positions[i]?.y ?? o.y,
    }));
    set({ objects: arranged });
    const persist = get().movePersistHandler;
    if (persist) {
      for (const o of arranged) persist(o.id, o.x, o.y);
    }
  },

  setViewportRect: (left, top, width, height) =>
    set((s) => ({ viewport: { ...s.viewport, left, top, width, height } })),

  submitPromptHandler: null,
  setSubmitPromptHandler: (handler) => set({ submitPromptHandler: handler }),

  movePersistHandler: null,
  setMovePersistHandler: (handler) => set({ movePersistHandler: handler }),

  forkHandler: null,
  setForkHandler: (handler) => set({ forkHandler: handler }),

  revealMRP: (id) => {
    const state = get();
    const obj = state.objects.find((o) => o.id === id);
    if (!obj) return;

    const { width: vw, height: vh, zoom: z, pan } = state.viewport;
    const cardW = obj.width;
    const cardH = obj.height;

    // Visible canvas region. The dock-reserve CSS var is set by FloatingDock
    // when it's mounted (288px) and removed on unmount. Reading it here
    // keeps store/dock decoupled — store doesn't need dock-internal constants.
    const rootStyle =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement)
        : null;
    const reserveStr = rootStyle?.getPropertyValue("--dock-reserve").trim() ?? "";
    const dockReserve = parseInt(reserveStr, 10) || 0;
    const visibleBottom = vh - dockReserve;

    // Object bounds in screen coords. Layer origin (world 0,0) sits at
    // canvas center + pan; world→screen is `vw/2 + pan.x + worldX * zoom`.
    const left   = vw / 2 + pan.x + obj.x * z;
    const top    = vh / 2 + pan.y + obj.y * z;
    const right  = left + cardW * z;
    const bottom = top + cardH * z;

    const fullyVisible =
      left >= 0 && right <= vw && top >= 0 && bottom <= visibleBottom;
    if (fullyVisible) return;

    // Otherwise center the object in the visible region (above the dock).
    const targetCenterY = visibleBottom / 2;
    const cardCenterX = obj.x + cardW / 2;
    const cardCenterY = obj.y + cardH / 2;
    const targetPanX = -cardCenterX * z;
    const targetPanY = targetCenterY - vh / 2 - cardCenterY * z;

    set((s) => ({
      viewport: { ...s.viewport, pan: { x: targetPanX, y: targetPanY } },
    }));
  },
}));

/* ── Cursor geometry helpers (private) ───────────────────────────────────── */

function objectCenter(o: CanvasObject): { x: number; y: number } {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}

/** Chronological order: by canonical thread sequence. Tab walks through the
 *  conversation in the order it happened — spatial layout doesn't matter. */
function sequenceOrder(mrps: MRPObject[]): MRPObject[] {
  return [...mrps].sort((a, b) => a.sequence - b.sequence);
}

/** 45° cone in the requested direction; nearest by Euclidean distance.
 *  Works on any object variant — uses width/height from ObjectBase. */
function findSpatialNeighbor(
  current: CanvasObject,
  candidates: CanvasObject[],
  direction: "up" | "down" | "left" | "right",
): CanvasObject | null {
  const cur = objectCenter(current);
  const inCone: CanvasObject[] = [];
  for (const c of candidates) {
    if (c.id === current.id) continue;
    const p = objectCenter(c);
    const dx = p.x - cur.x;
    const dy = p.y - cur.y;
    const within =
      direction === "right" ? dx > 0 && Math.abs(dy) <= dx :
      direction === "left"  ? dx < 0 && Math.abs(dy) <= -dx :
      direction === "down"  ? dy > 0 && Math.abs(dx) <= dy :
      /* up */                dy < 0 && Math.abs(dx) <= -dy;
    if (within) inCone.push(c);
  }
  if (inCone.length === 0) return null;
  let best: CanvasObject | null = null;
  let bestDist = Infinity;
  for (const c of inCone) {
    const p = objectCenter(c);
    const d = Math.hypot(p.x - cur.x, p.y - cur.y);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
