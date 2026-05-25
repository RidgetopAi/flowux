import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import { GripHorizontal, Pin, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useCanvas } from "../../lib/store";
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
const DOCK_RESERVE_PX = 288;

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

  /* History navigation state. null = composing a fresh draft (textarea
   * shows dockDraft). When the user walks back with Up, historyIndex
   * indexes into promptHistory and the textarea mirrors that entry.
   * Walking forward past the newest entry returns to the draft. We also
   * snapshot the in-progress draft on first walk-back so it isn't lost. */
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftSnapshotRef = useRef<string>("");

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

  /* Autofocus textarea on mount so the user can start typing immediately. */
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /* Publish a CSS variable so the ExpandedMRP overlay knows how much
   * vertical space to leave for the dock at the bottom. Cleared on
   * unmount (when dock closes) so the overlay reclaims the space. */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dock-reserve", `${DOCK_RESERVE_PX}px`);
    return () => {
      root.style.removeProperty("--dock-reserve");
    };
  }, []);

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
    const id = addMRP({
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
    /* "Thinking" beat — gives the expanded view a moment to land, then
     * the response fills in. Mocked here; the real call would stream. */
    window.setTimeout(() => {
      patchMRP(id, {
        status: "complete",
        response:
          STUB_RESPONSES[Math.floor(Math.random() * STUB_RESPONSES.length)],
        tokens: 240 + Math.floor(Math.random() * 1200),
      });
    }, 700);
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
            placeholder="What's on your mind?"
            rows={3}
            spellCheck
            autoComplete="off"
          />
        </div>

        <footer className="dock__foot">
          <Label size="micro" tone="muted">
            {draft.length} chars
            {dockAttachments.length > 0 &&
              ` · ${dockAttachments.length} attachment${dockAttachments.length === 1 ? "" : "s"}`}
            {" · ⌘+Enter to send"}
          </Label>
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
    </motion.div>
  );
}
