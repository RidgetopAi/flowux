import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, type PanInfo } from "motion/react";
import {
  Check,
  Clipboard,
  EyeOff,
  GitFork,
  GripHorizontal,
  Maximize2,
  SquareCheck,
} from "lucide-react";
import { useCanvas, type MRP } from "../../lib/store";
import { Card } from "../primitives/Card";
import { Pill } from "../primitives/Pill";
import { StatusDot } from "../primitives/StatusDot";
import { cn } from "../../lib/cn";
import { CardContextMenu, type MenuItem } from "./CardContextMenu";
import "./MRPCard.css";

type Props = { mrp: MRP };

/**
 * Renders one MRP as a draggable card on the canvas.
 *
 * Position model: `mrp.x/y` is canvas-space (parent layer applies pan).
 * During drag, Motion's transform overlays a temporary offset; on dragEnd
 * we commit that offset into mrp.x/y and reset the transform. Snap.
 *
 * Click vs drag is handled by Motion's `onTap` — it only fires when the
 * press didn't move past Motion's drag threshold (3px default). No manual
 * bookkeeping flags that can get stale.
 */
export function MRPCard({ mrp }: Props) {
  const expandedId = useCanvas((s) => s.expandedId);
  const draggingId = useCanvas((s) => s.draggingId);
  const cursorId = useCanvas((s) => s.cursorId);
  const checkedCount = useCanvas((s) => s.objects.filter((o) => o.checked).length);
  const moveObject = useCanvas((s) => s.moveObject);
  const setExpanded = useCanvas((s) => s.setExpanded);
  const setDragging = useCanvas((s) => s.setDragging);
  const setCursor = useCanvas((s) => s.setCursor);
  const toggleCheck = useCanvas((s) => s.toggleCheck);

  const isExpanded = expandedId === mrp.id;
  const isDragging = draggingId === mrp.id;
  const isCursor = cursorId === mrp.id;
  const forkActsOnBundle = mrp.checked && checkedCount > 1;

  // ── All hooks must run unconditionally on every render. The early-return
  //    for `isExpanded` lives BELOW this block. ─────────────────────────────

  // Motion values stay at 0 until drag — we commit deltas to store on dragEnd.
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Double-tap to expand. Single tap = no-op so a quick click-then-drag-pause
  // doesn't accidentally open the expanded view. 280ms window matches the
  // typical touch double-tap interval (snappier than the browser's 500ms default).
  const tapTimerRef = useRef<number | null>(null);

  // Group-drag state. Set on dragStart if this card is bundled — captures
  // follower DOM elements + their start positions so onDrag can update
  // their visual position IMPERATIVELY (no React re-renders) via the CSS
  // `translate` property. Store gets one commit on dragEnd.
  //
  // Why DOM-direct: per-frame setState during drag triggers re-renders of
  // every card every pointer event (hundreds/sec on a fast mouse). That
  // backs up the event loop until Chrome flags the page unresponsive.
  // Why `translate` (not `transform`): Motion uses transform for its
  // own animations (whileHover, etc.); the separate `translate` CSS prop
  // composes cleanly without fighting Motion.
  const groupDragRef = useRef<{
    followers: Array<{
      id: string;
      el: HTMLElement;
      startX: number;
      startY: number;
    }>;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
      }
    };
  }, []);

  // Right-click context menu position. Declared HERE — above the
  // `if (isExpanded) return null` guard below — so the hook count stays
  // constant across renders (a card flipping into expanded state would
  // otherwise unmount a useState mid-life, crashing React with
  // "Rendered fewer hooks than expected").
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // While focused, the ExpandedMRP layer takes over. Returning null lets
  // Motion's layoutId pull off the shared-element FLIP cleanly (only one
  // element per layoutId should be mounted at a time).
  if (isExpanded) return null;

  // State precedence: external > selected (checked) > active > idle
  const cardState =
    mrp.external ? "external" :
    mrp.checked ? "checked" :
    mrp.status === "active" ? "active" : "idle";

  const onDragStart = () => {
    setDragging(mrp.id);
    // Cursor follows whatever card the user last touched.
    setCursor(mrp.id);

    // If this card is bundled, capture every OTHER bundled card's wrap
    // element + start position. onDrag will move them imperatively.
    if (mrp.checked) {
      const allObjects = useCanvas.getState().objects;
      const bundleFollowers = allObjects.filter(
        (o) => o.checked && o.id !== mrp.id,
      );
      const captured: typeof groupDragRef.current = { followers: [] };
      for (const f of bundleFollowers) {
        const el = document.querySelector<HTMLElement>(
          `[data-object-id="${f.id}"]`,
        );
        if (!el) continue;
        captured.followers.push({
          id: f.id,
          el,
          startX: f.x,
          startY: f.y,
        });
      }
      if (captured.followers.length > 0) {
        // Trailing-delay easing on followers — they lag the leader by
        // roughly half this duration, conveying "being pulled along"
        // rather than rigidly attached. Same ease curve we use for the
        // pickup/settle motion language across the canvas.
        for (const f of captured.followers) {
          f.el.style.transition = "translate 140ms cubic-bezier(0.16, 1, 0.3, 1)";
        }
        groupDragRef.current = captured;
      }
    }
  };

  // Per-frame follower sync — DOM-direct, no React. The leader is driven
  // by Motion's own drag transform. Followers get an inline CSS `translate`
  // matching the leader's offset; they look like they're moving even though
  // their store positions haven't changed yet.
  const onDrag = (_e: PointerEvent | TouchEvent | MouseEvent, info: PanInfo) => {
    const groupDrag = groupDragRef.current;
    if (!groupDrag) return;
    const dx = `${info.offset.x}px`;
    const dy = `${info.offset.y}px`;
    for (const f of groupDrag.followers) {
      f.el.style.translate = `${dx} ${dy}`;
    }
  };

  const onDragEnd = (_e: PointerEvent, info: PanInfo) => {
    // Commit leader.
    moveObject(mrp.id, mrp.x + info.offset.x, mrp.y + info.offset.y);
    x.set(0);
    y.set(0);
    setDragging(null);

    // Commit followers in one batched setState, then clear their inline
    // translates so the new left/top from the re-render lands cleanly.
    const groupDrag = groupDragRef.current;
    if (groupDrag) {
      const updates = new Map<string, { x: number; y: number }>(
        groupDrag.followers.map((f) => [
          f.id,
          { x: f.startX + info.offset.x, y: f.startY + info.offset.y },
        ]),
      );
      useCanvas.setState((s) => ({
        objects: s.objects.map((o) => {
          const u = updates.get(o.id);
          return u ? { ...o, x: u.x, y: u.y } : o;
        }),
      }));
      // Clear inline styles AFTER React commits the new left/top. If we
      // cleared translate immediately, the followers would visibly snap
      // back to their start position for a frame before the re-render
      // landed. rAF defers cleanup past the React commit.
      const followers = groupDrag.followers;
      requestAnimationFrame(() => {
        for (const f of followers) {
          f.el.style.transition = "";
          f.el.style.translate = "";
        }
      });
    }
    groupDragRef.current = null;
  };

  const onTap = () => {
    // Every tap moves the cursor to this card — so arrow keys pick up here.
    setCursor(mrp.id);

    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      setExpanded(mrp.id);
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
    }, 280);
  };

  const onCheckClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleCheck(mrp.id);
  };

  // Fork (branch from this card or the whole bundle). Acts on the bundle if
  // multiple cards are checked — otherwise just this single card. The actual
  // "new conversation with this context" is handled by useCanvas.forkHandler,
  // which the host app (App.tsx) wires up to call apps/api's branch endpoint
  // with the source MRP ids resolved from the canvas objects.
  const runFork = () => {
    const all = useCanvas.getState().objects;
    const checkedIds = all.filter((o) => o.checked).map((o) => o.id);
    const bundleAct = checkedIds.length > 1 && checkedIds.includes(mrp.id);
    const sourceIds = bundleAct ? checkedIds : [mrp.id];
    const fork = useCanvas.getState().forkHandler;
    if (fork) {
      fork(sourceIds);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        bundleAct
          ? `[fork] from bundle (${sourceIds.length} cards): ${sourceIds.join(", ")}`
          : `[fork] from single card: ${sourceIds[0]}`,
      );
    }
  };
  const onForkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    runFork();
  };

  // Right-click context menu — anchored to clientX/Y, portal-mounted so
  // canvas transforms don't clip it. State is declared above the
  // isExpanded early-return; this section just wires the handler +
  // menu items that consume it.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const copyMrpId = () => {
    void navigator.clipboard.writeText(mrp.id).catch(() => {
      // Clipboard failures (insecure context, denied permission) are silent
      // — the menu still closes, which is the user-visible feedback.
    });
  };

  const menuItems: MenuItem[] = [
    {
      kind: "action",
      icon: <Maximize2 size={13} />,
      label: "Open",
      shortcut: "↵",
      onSelect: () => {
        setExpanded(mrp.id);
      },
    },
    {
      kind: "action",
      icon: mrp.checked ? <SquareCheck size={13} /> : <Check size={13} />,
      label: mrp.checked ? "Remove from bundle" : "Add to bundle",
      shortcut: "Space",
      onSelect: () => toggleCheck(mrp.id),
    },
    {
      kind: "action",
      icon: <GitFork size={13} />,
      label: forkActsOnBundle
        ? `Fork from bundle (${checkedCount})`
        : "Fork from this card",
      onSelect: () => runFork(),
    },
    { kind: "separator" },
    {
      kind: "action",
      icon: <Clipboard size={13} />,
      label: "Copy MRP id",
      onSelect: copyMrpId,
    },
    {
      kind: "action",
      icon: <EyeOff size={13} />,
      label: "Hide from search results",
      disabled: true,
      onSelect: () => {
        // Placeholder — wired in a later iteration when the search filter
        // grows a per-MRP exclusion list. Disabled keeps the affordance
        // discoverable without faking behavior.
      },
    },
  ];

  // Two-layer motion structure:
  //   OUTER — owns position (left/top from store), mount animation (fade+rise),
  //           and hover lift. Its `y` is for hover, NOT for drag.
  //   INNER — owns drag (x/y motion values), drag-picked-up visual state.
  // Splitting them avoids the conflict between drag's motion values and
  // hover/animate's automatic animations writing to the same property.
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      whileHover={!isDragging
        ? { y: -3, transition: { duration: 0.18, ease: "easeOut" } }
        : undefined}
      style={{
        position: "absolute",
        left: mrp.x,
        top: mrp.y,
        width: mrp.width,
        zIndex: isDragging ? 30 : 5,
      }}
      data-checked={mrp.checked ? "true" : undefined}
      data-object-id={mrp.id}
      className={cn("mrp-card-wrap", isDragging && "is-dragging")}
      onContextMenu={onContextMenu}
    >
      <motion.div
        data-canvas-card
        data-dragging={isDragging ? "true" : undefined}
        data-cursor={isCursor ? "true" : undefined}
        drag
        dragMomentum={false}
        dragElastic={0}
        onDragStart={onDragStart}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onTap={onTap}
        whileDrag={{
          scale: 1.025,
          rotate: -0.6,
          transition: { duration: 0.14, ease: "easeOut" },
        }}
        style={{ x, y }}
        className="mrp-card-drag-layer"
      >
      <Card state={cardState} className="mrp-card">
        <Card.DragBar>
          <button
            type="button"
            className={cn("mrp-check", mrp.checked && "mrp-check--on")}
            onClick={onCheckClick}
            aria-label={mrp.checked ? "Remove from bundle" : "Add to bundle"}
            aria-pressed={mrp.checked}
          >
            {mrp.checked && <Check />}
          </button>
          <span className="mrp-drag-handle">
            <GripHorizontal />
          </span>
          <span className="mrp-seq">MRP · {String(mrp.sequence).padStart(4, "0")}</span>
          <span className="mrp-drag-spacer" />
          <span className="mrp-drag-side">
            {mrp.external ? "EXTERNAL" : cardState.toUpperCase()}
          </span>
          <button
            type="button"
            className={cn("mrp-fork", forkActsOnBundle && "mrp-fork--bundle")}
            onClick={onForkClick}
            aria-label={
              forkActsOnBundle
                ? `Fork conversation from bundle (${checkedCount} cards)`
                : "Fork conversation from this card"
            }
            title={
              forkActsOnBundle
                ? `Fork from bundle (${checkedCount})`
                : "Fork from this card"
            }
          >
            <GitFork />
          </button>
        </Card.DragBar>

        <Card.Header>
          <Card.Title>{mrp.prompt}</Card.Title>
        </Card.Header>

        <Card.Meta>
          <Pill tone={mrp.external ? "violet" : "cyan"}>{mrp.model}</Pill>
          {mrp.tokens > 0 && <Pill>{formatTokens(mrp.tokens)} tok</Pill>}
          <Pill>{formatTime(mrp.timestamp)}</Pill>
          {mrp.parentId && <Pill tone="violet">branched</Pill>}
          {mrp.branchOutCount && (
            <Pill tone="violet" emphasis>
              forked ×{mrp.branchOutCount}
            </Pill>
          )}
        </Card.Meta>

        {mrp.response && (
          <Card.Body>
            <Card.Section>
              <p className="mrp-response">{mrp.response}</p>
            </Card.Section>
          </Card.Body>
        )}

        <Card.Footer>
          <span className="mrp-foot-id">
            {mrp.parentId ? `↳ ${mrp.parentId.replace("mrp-", "")} → ${mrp.id.replace("mrp-", "")}` : mrp.id}
          </span>
          <StatusDot status={mrp.status} size="sm" />
        </Card.Footer>
      </Card>
      </motion.div>
      {ctxMenu && (
        <CardContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={menuItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </motion.div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
