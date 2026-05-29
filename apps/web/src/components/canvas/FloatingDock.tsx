import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import {
  ChevronRight,
  Eraser,
  Gamepad2,
  GitBranch,
  GripHorizontal,
  History as HistoryIcon,
  Layers,
  Maximize2,
  Pin,
  Search,
  X,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "../../lib/cn";
import { useCanvas } from "../../lib/store";
import { useFlowuxStore } from "../../store.js";
import { Button } from "../primitives/Button";
import { Label } from "../primitives/Label";
import { Pill } from "../primitives/Pill";
import { BrailleBand } from "../effects/BrailleBand";
import "./FloatingDock.css";

/* Mock responses for the playground send flow — the real LLM call lives
 * in flowux proper. We just need enough shape to feel the UI flow. */
const STUB_RESPONSES = [
  "That's a sharp framing. Let me unpack it: the spatial canvas lets you compose context across threads — what you select becomes the bundle, the bundle becomes the next prompt's context.",
  "Branching from a bundle creates a new conversation seeded with those specific MRPs as parent context. The parent canvas stays untouched — branches are additive, never destructive.",
  "The two-view model serves different reasoning modes. Blocked = quick scanning, grid arrangement, post-it wall feel. Flow = following a chain of reasoning, branching-aware.",
  "Selection IS the bundle. Manual checkbox click and keyboard Space both feed the same set. Esc clears it as a fast reset; explicit Save makes it a named template you can recall later.",
  "Group drag preserves spatial intent — when you sweep a set of cards to a new region, the bundle moves as one unit. Trailing delay on followers gives the cluster weight.",
];

/* ── Slash command palette ────────────────────────────────────────────
 * Static command registry. When the draft starts with `/` and has no
 * whitespace, the dock renders a drawer of matching commands above the
 * textarea. Enter executes, Tab completes, Esc exits slash mode.
 *
 * Each command is FlowUX-native — it drives store actions directly. Pi-
 * forwarding commands (/compact, /session, /model, …) live in a separate
 * future iteration that pipes the slash through to the Pi RPC stream.
 */
type SlashCommand = {
  name: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  exec: (ctx: SlashExecContext) => void;
};

type SlashExecContext = {
  closeDock: () => void;
  setDraft: (s: string) => void;
  clearBundle: () => void;
  zoomToFit: () => void;
  setSidebarTab: (tab: "search" | "bundles" | "branches" | "imports" | "history") => void;
  focusSidebarSearch: () => void;
  createChildFromSelection: () => Promise<void> | void;
  openInvaders: () => void;
  flagError: (msg: string) => void;
};

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "branch",
    label: "Branch from checked MRPs",
    icon: GitBranch,
    exec: ({ createChildFromSelection, setDraft, closeDock, flagError }) => {
      try {
        const result = createChildFromSelection();
        if (result && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>);
        }
        setDraft("");
        closeDock();
      } catch (e) {
        flagError(e instanceof Error ? e.message : "branch failed");
      }
    },
  },
  {
    name: "fit",
    label: "Zoom to fit all cards",
    icon: Maximize2,
    exec: ({ zoomToFit, setDraft, closeDock }) => {
      zoomToFit();
      setDraft("");
      closeDock();
    },
  },
  {
    name: "unlink",
    label: "Clear bundle (uncheck all)",
    icon: Eraser,
    exec: ({ clearBundle, setDraft, closeDock }) => {
      clearBundle();
      setDraft("");
      closeDock();
    },
  },
  {
    name: "find",
    label: "Focus sidebar search",
    icon: Search,
    exec: ({ focusSidebarSearch, setDraft, closeDock }) => {
      setDraft("");
      closeDock();
      // Defer one tick so the dock unmount doesn't steal focus back.
      window.setTimeout(() => focusSidebarSearch(), 0);
    },
  },
  {
    name: "history",
    label: "Open prompt history",
    icon: HistoryIcon,
    exec: ({ setSidebarTab, setDraft, closeDock }) => {
      setSidebarTab("history");
      setDraft("");
      closeDock();
    },
  },
  {
    name: "bundles",
    label: "Open saved bundles",
    icon: Layers,
    exec: ({ setSidebarTab, setDraft, closeDock }) => {
      setSidebarTab("bundles");
      setDraft("");
      closeDock();
    },
  },
  {
    name: "branches",
    label: "Open branch panel",
    icon: GitBranch,
    exec: ({ setSidebarTab, setDraft, closeDock }) => {
      setSidebarTab("branches");
      setDraft("");
      closeDock();
    },
  },
  {
    name: "invaders",
    label: "Project Space Invaders onto the board",
    icon: Gamepad2,
    exec: ({ openInvaders, setDraft, closeDock }) => {
      setDraft("");
      closeDock();
      // Defer one tick so the dock unmount doesn't race the overlay mount
      // and steal back the focus / keyboard authority.
      window.setTimeout(() => openInvaders(), 0);
    },
  },
];

/* Render the dock with mount/exit animation managed via AnimatePresence. */
export function FloatingDockLayer() {
  const dockOpen = useCanvas((s) => s.dockOpen);
  return (
    <AnimatePresence>{dockOpen && <FloatingDock />}</AnimatePresence>
  );
}

const DOCK_WIDTH = 720;
/* Measured at runtime; ~253px with current padding + 3-row textarea +
 * footer button height. Treated as an estimate for initial position;
 * the actual rendered height is what determines coexistence layout. */
const DOCK_HEIGHT_GUESS = 256;
const DOCK_GAP_FROM_EDGE = 24;
/* Space the expanded overlay needs to leave at the bottom of the viewport
 * for the dock to stay visible underneath it. Sum: dock height (~256) +
 * bottom edge gap (24) + small breathing buffer (8). */
/** Visual gap between the dock and the expanded-MRP overlay above it.
 *  The reserve = dock height + this gap. Kept small so the overlay
 *  uses as much vertical space as possible. */
const DOCK_RESERVE_GAP_PX = 12;

function computeDefaultPos(): { x: number; y: number } {
  const x = Math.max(16, (window.innerWidth - DOCK_WIDTH) / 2);
  const y = Math.max(16, window.innerHeight - DOCK_HEIGHT_GUESS - DOCK_GAP_FROM_EDGE);
  return { x, y };
}

function FloatingDock() {
  const dockPosition = useCanvas((s) => s.dockPosition);
  const setDockPosition = useCanvas((s) => s.setDockPosition);
  const draft = useCanvas((s) => s.dockDraft);
  const setDraft = useCanvas((s) => s.setDockDraft);
  const closeDock = useCanvas((s) => s.closeDock);
  const addMRP = useCanvas((s) => s.addMRP);
  const patchMRP = useCanvas((s) => s.patchMRP);
  const submitPromptHandler = useCanvas((s) => s.submitPromptHandler);
  const setExpanded = useCanvas((s) => s.setExpanded);
  const revealMRP = useCanvas((s) => s.revealMRP);
  const promptHistory = useCanvas((s) => s.promptHistory);
  const pushPromptHistory = useCanvas((s) => s.pushPromptHistory);
  const dockLockAnchor = useCanvas((s) => s.dockLockAnchor);
  const setDockLockAnchor = useCanvas((s) => s.setDockLockAnchor);
  const toggleDockLock = useCanvas((s) => s.toggleDockLock);
  const viewport = useCanvas((s) => s.viewport);
  const dockAttachments = useCanvas((s) => s.dockAttachments);
  const removeDockAttachment = useCanvas((s) => s.removeDockAttachment);
  const clearDockAttachments = useCanvas((s) => s.clearDockAttachments);
  const addImage = useCanvas((s) => s.addImage);
  const clearBundle = useCanvas((s) => s.clearBundle);
  const zoomToFit = useCanvas((s) => s.zoomToFit);
  const setSidebarTab = useCanvas((s) => s.setSidebarTab);
  const focusSidebarSearch = useCanvas((s) => s.focusSidebarSearch);
  const openInvaders = useCanvas((s) => s.openInvaders);
  const createChildCanvasFromSelection = useFlowuxStore((s) => s.createChildCanvasFromSelection);
  // Stable handle to push a one-shot error into the topbar status pill.
  const flagError = (msg: string) => useFlowuxStore.setState({ error: msg });

  /* History navigation state. null = composing a fresh draft (textarea
   * shows dockDraft). When the user walks back with Up, historyIndex
   * indexes into promptHistory and the textarea mirrors that entry.
   * Walking forward past the newest entry returns to the draft. We also
   * snapshot the in-progress draft on first walk-back so it isn't lost. */
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftSnapshotRef = useRef<string>("");

  /* Slash command palette state. Slash mode = the entire draft starts with
   * `/` and contains no whitespace. While in slash mode, the textarea acts
   * as a command picker — arrow keys nav matches, Enter executes, Tab
   * completes the typed token, Esc exits slash mode by clearing the draft. */
  const isSlashMode = draft.startsWith("/") && !/\s/.test(draft) && draft.length >= 1;
  const slashToken = isSlashMode ? draft.slice(1).toLowerCase() : "";
  const slashMatches = isSlashMode
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashToken))
    : [];
  const [slashSelected, setSlashSelected] = useState(0);
  // Clamp selection when matches list shrinks (e.g. user types another
  // letter that filters more strictly).
  useEffect(() => {
    if (slashSelected >= slashMatches.length) setSlashSelected(0);
  }, [slashMatches.length, slashSelected]);

  const execSlash = (cmd: SlashCommand) => {
    cmd.exec({
      closeDock,
      setDraft,
      clearBundle,
      zoomToFit,
      setSidebarTab,
      focusSidebarSearch,
      openInvaders,
      createChildFromSelection: createChildCanvasFromSelection,
      flagError,
    });
  };

  /* Default position — recomputed on resize ONLY when the user hasn't
   * committed an explicit drag position. Once they drag, their position
   * sticks (until the next session/reset). */
  const [defaultPos, setDefaultPos] = useState(computeDefaultPos);
  useEffect(() => {
    if (dockPosition !== null) return;
    const update = () => setDefaultPos(computeDefaultPos());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [dockPosition]);

  /* Resolve the dock's effective viewport position:
   *   - LOCKED: compute from the world anchor + current pan/zoom + canvas
   *     surface offset. Pan/zoom changes re-position the dock automatically.
   *     Size stays constant (dock is rendered outside the scaled canvas
   *     layer), only position moves.
   *   - UNLOCKED: use the user-dragged dockPosition (or the centered
   *     default if they haven't dragged it). Current viewport-fixed behavior. */
  const pos = dockLockAnchor
    ? {
        x:
          viewport.left +
          viewport.width / 2 +
          viewport.pan.x +
          dockLockAnchor.x * viewport.zoom,
        y:
          viewport.top +
          viewport.height / 2 +
          viewport.pan.y +
          dockLockAnchor.y * viewport.zoom,
      }
    : (dockPosition ?? defaultPos);

  /* Motion values for drag transform; reset to 0 after dragEnd so the
   * commit lands at `pos` cleanly. Same two-layer pattern as MRPCard:
   * outer owns mount/exit animation, inner owns drag. */
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const dragControls = useDragControls();

  const onDragEnd = (_e: PointerEvent, info: PanInfo) => {
    if (dockLockAnchor) {
      /* Locked: convert screen-delta back into world-delta (divide by zoom)
       * and commit to the world anchor. Pan/zoom-driven repositioning then
       * picks up the new spot on the next render. */
      setDockLockAnchor({
        x: dockLockAnchor.x + info.offset.x / viewport.zoom,
        y: dockLockAnchor.y + info.offset.y / viewport.zoom,
      });
    } else {
      setDockPosition({ x: pos.x + info.offset.x, y: pos.y + info.offset.y });
    }
    dragX.set(0);
    dragY.set(0);
  };

  /* Autofocus textarea on mount so the user can start typing immediately,
   * and put the caret at the END of any existing draft (e.g. when "/"
   * opened the dock and seeded "/" so the slash palette would render —
   * the user expects to keep typing the command name from there). */
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  /* Publish a CSS variable so the ExpandedMRP overlay knows how much
   * vertical space to leave for the dock at the bottom. Tracks the dock's
   * actual rendered height via ResizeObserver so the overlay stays as
   * tall as possible regardless of dock state (attachments staged,
   * slash palette open, draft growing, etc.). Cleared on unmount. */
  const dockSizeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dockSizeRef.current;
    const root = document.documentElement;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      root.style.setProperty("--dock-reserve", `${Math.ceil(h + DOCK_RESERVE_GAP_PX)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--dock-reserve");
    };
  }, []);

  /* Refresh the canvas-HUD context-budget meter while composing. Debounced
   * (280ms) so typing doesn't spam the estimate endpoint; also fires once
   * on mount with the current draft so the chip is accurate the moment the
   * dock opens. Dock-staged attachments aren't uploaded yet (no id) so they
   * don't contribute to the estimate until send; the prompt text + already-
   * checked MRPs are what the meter reflects during composition. */
  const refreshContextBudget = useFlowuxStore((s) => s.refreshContextBudget);
  useEffect(() => {
    const id = window.setTimeout(() => {
      void refreshContextBudget(draft);
    }, 280);
    return () => window.clearTimeout(id);
  }, [draft, refreshContextBudget]);

  /* Toggle the dock's lock-to-canvas state. Hands the store the current
   * viewport top-left so it can convert to a world anchor (lock) or just
   * keep the visible position (unlock). */
  const onTogglePin = () => {
    toggleDockLock(pos);
  };

  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    /* Typing while reviewing history "forks" the entry into a new draft —
     * exit history mode so subsequent Up starts a fresh walk from newest. */
    if (historyIndex !== null) {
      setHistoryIndex(null);
      draftSnapshotRef.current = "";
    }
  };

  const onSend = () => {
    const prompt = draft.trim();
    // Allow send when there's either a prompt OR staged attachments
    // (image-only "look at this" is a valid turn).
    if (!prompt && dockAttachments.length === 0) return;
    // External handler (apps/api-bound) takes over when registered. The
    // sync addMRP fallback is used in playground/standalone mode where
    // there is no backend; it returns an id immediately for the image
    // anchor chain below.
    const id = submitPromptHandler
      ? submitPromptHandler({ prompt: prompt || "(image attached)", attachments: dockAttachments })
      : addMRP({
          prompt: prompt || "(image attached)",
          response: "",
          status: "pending",
          tokens: 0,
        });
    if (prompt) pushPromptHistory(prompt);
    setDraft("");
    setHistoryIndex(null);
    draftSnapshotRef.current = "";

    /* Materialize every staged attachment as a real ImageObject anchored
     * to the new MRP. addImage's default anchor logic (right of most-
     * recent MRP) lines up since the new MRP IS the most recent. Multi-
     * image case stacks them via store math; for single image this just
     * lands one to the right of the prompt card. */
    for (const att of dockAttachments) {
      addImage({
        src: att.src,
        alt: att.alt,
        naturalWidth: att.naturalWidth,
        naturalHeight: att.naturalHeight,
        anchoredToId: id,
      });
    }
    clearDockAttachments();

    /* Dock stays open across sends — this is a conversation surface,
     * not a one-shot input. */
    setExpanded(id);
    revealMRP(id);
    /* Standalone-mode "thinking" beat (no real backend). With an external
     * submitPromptHandler the real apps/api stream patches the snapshot
     * and loadFromSnapshot keeps the canvas in sync — no local stub. */
    if (!submitPromptHandler) {
      window.setTimeout(() => {
        patchMRP(id, {
          status: "complete",
          response:
            STUB_RESPONSES[Math.floor(Math.random() * STUB_RESPONSES.length)],
          tokens: 240 + Math.floor(Math.random() * 1200),
        });
      }, 700);
    }
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /* Slash command palette captures the textarea while the user is
     * picking a command. Order matters: this must run BEFORE the regular
     * Enter / Arrow / Esc handlers below so the drawer wins. Only takes
     * over when there's at least one match to show. */
    if (isSlashMode && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelected((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelected((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      // Plain Enter executes; Cmd/Ctrl+Enter falls through to send so the
      // user can still escape-hatch by force-submitting the literal "/foo".
      const picked = slashMatches[slashSelected] ?? slashMatches[0];
      if (!picked) return;
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        execSlash(picked);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setDraft(`/${picked.name}`);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDraft("");
        return;
      }
    }

    /* Cmd/Ctrl+Enter sends; plain Enter inserts a newline (chat-comfortable). */
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSend();
      return;
    }

    /* Prompt-history nav. Up walks back, Down walks forward, but ONLY when
     * the caret is at the very start/end of the textarea — otherwise plain
     * Up/Down should do their normal line-nav inside multi-line content.
     * Snapshot the in-progress draft on first walk-back so it's restored
     * when the user walks forward past the newest entry. */
    const ta = e.currentTarget;
    const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    const atEnd =
      ta.selectionStart === ta.value.length &&
      ta.selectionEnd === ta.value.length;

    if (e.key === "ArrowUp" && atStart && promptHistory.length > 0) {
      e.preventDefault();
      if (historyIndex === null) {
        draftSnapshotRef.current = draft;
        const nextIdx = promptHistory.length - 1;
        setHistoryIndex(nextIdx);
        setDraft(promptHistory[nextIdx] ?? "");
      } else if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setDraft(promptHistory[nextIdx] ?? "");
      }
      return;
    }
    if (e.key === "ArrowDown" && atEnd && historyIndex !== null) {
      e.preventDefault();
      if (historyIndex < promptHistory.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setDraft(promptHistory[nextIdx] ?? "");
      } else {
        /* Past the newest entry → restore the in-progress draft. */
        setHistoryIndex(null);
        setDraft(draftSnapshotRef.current);
      }
      return;
    }

    /* Esc ladder when both the dock and an expanded MRP are up:
     *   1st Esc → closes the MRP (handled by ExpandedMRP's window listener),
     *             dock stays put so the user can keep composing
     *   2nd Esc → closes the dock
     * When no MRP is expanded, Esc closes the dock directly.
     * The previous behavior collapsed the order because we always called
     * stopPropagation here — which stops the NATIVE event too in React 17+,
     * so ExpandedMRP's window listener never saw the first Esc. */
    if (e.key === "Escape") {
      if (useCanvas.getState().expandedId) {
        /* Defer to ExpandedMRP — let the native event reach the window. */
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeDock();
    }
  };

  return (
    <motion.div
      className="dock-layer"
      initial={{ opacity: 0, scale: 0.96, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 16 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: DOCK_WIDTH,
        zIndex: 150,
      }}
    >
      <motion.div
        ref={dockSizeRef}
        className="dock"
        drag
        dragListener={false}
        dragControls={dragControls}
        dragMomentum={false}
        dragElastic={0}
        onDragEnd={onDragEnd}
        style={{ x: dragX, y: dragY }}
      >
        <header
          className="dock__head"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="dock__head-l">
            <Label tone="cyan" size="micro">COMPOSE</Label>
            <span className="dock__head-divider" />
            <Label size="micro" tone="muted">draft</Label>
            <BrailleBand length={20} density={0.42} tone="cyan" seed={11} />
            <span className="dock__grip" aria-hidden="true">
              <GripHorizontal />
            </span>
          </div>
          <div className="dock__head-r">
            <Pill tone="cyan">opus-4.7</Pill>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={onTogglePin}
              className={cn("dock__pin", dockLockAnchor && "dock__pin--on")}
              aria-label={
                dockLockAnchor
                  ? "Unpin from canvas (return to viewport)"
                  : "Pin to canvas (pan/zoom with cards)"
              }
              title={
                dockLockAnchor ? "Unpin from canvas" : "Pin to canvas"
              }
              aria-pressed={!!dockLockAnchor}
            >
              <Pin />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={closeDock}
              aria-label="Close compose"
            >
              <X />
            </Button>
          </div>
        </header>

        <div className="dock__body">
          {dockAttachments.length > 0 && (
            <div className="dock__attachments" role="list" aria-label="Staged attachments">
              {dockAttachments.map((att, i) => (
                <div key={att.src + i} className="dock-att" role="listitem">
                  <img className="dock-att__thumb" src={att.src} alt={att.alt ?? ""} />
                  <span className="dock-att__name">{att.alt ?? "image"}</span>
                  <button
                    type="button"
                    className="dock-att__remove"
                    onClick={() => removeDockAttachment(i)}
                    aria-label={`Remove ${att.alt ?? "image"}`}
                    title="Remove attachment"
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="dock__input"
            value={draft}
            onChange={onTextareaChange}
            onKeyDown={onTextareaKeyDown}
            placeholder="What's on your mind? Type / for commands."
            rows={3}
            spellCheck
            autoComplete="off"
          />
        </div>

        <footer className="dock__foot">
          <div className="dock__foot-l">
            <Label size="micro" tone="muted">
              {draft.length} chars
              {dockAttachments.length > 0 &&
                ` · ${dockAttachments.length} attachment${dockAttachments.length === 1 ? "" : "s"}`}
            </Label>
            <span className="dock__hints" aria-hidden="true">
              <kbd>⌘↵</kbd>send
              <kbd>↵</kbd>newline
              {promptHistory.length > 0 && (
                <>
                  <kbd>↑↓</kbd>history
                </>
              )}
              <kbd>esc</kbd>close
            </span>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={onSend}
            disabled={!draft.trim() && dockAttachments.length === 0}
            aria-label="Send"
          >
            Send
          </Button>
        </footer>
      </motion.div>

      {/* Slash palette — portal-mounted ABOVE the dock so its growth pushes
          upward instead of stretching the dock past the viewport bottom.
          Position is recomputed each render from `pos` (the dock's viewport
          coords), so dragging the dock between sessions naturally moves the
          drawer with it. z-index sits above .dock-layer's 150. */}
      {isSlashMode && slashMatches.length > 0 &&
        createPortal(
          <div
            className="dock__slash dock__slash--popover"
            role="listbox"
            aria-label="Slash commands"
            style={{
              position: "fixed",
              left: pos.x + 16,
              width: DOCK_WIDTH - 32,
              bottom: window.innerHeight - pos.y + 8,
              zIndex: 160,
            }}
          >
            {slashMatches.map((cmd, i) => {
              const Icon = cmd.icon;
              const active = i === slashSelected;
              return (
                <button
                  key={cmd.name}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={cn("dock__slash-row", active && "dock__slash-row--active")}
                  onMouseEnter={() => setSlashSelected(i)}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before exec runs.
                    e.preventDefault();
                    execSlash(cmd);
                  }}
                >
                  <Icon size={13} className="dock__slash-icon" aria-hidden="true" />
                  <span className="dock__slash-name">/{cmd.name}</span>
                  <span className="dock__slash-label">{cmd.label}</span>
                  {active && (
                    <ChevronRight size={12} className="dock__slash-chev" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </motion.div>
  );
}
