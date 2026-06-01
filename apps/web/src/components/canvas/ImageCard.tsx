import { useEffect, useRef } from "react";
import { motion, useMotionValue, type PanInfo } from "motion/react";
import { Check, Trash2 } from "lucide-react";
import { useCanvas, type ImageObject } from "../../lib/store";
import { cn } from "../../lib/cn";
import "./ImageCard.css";

type Props = { image: ImageObject };

/** True when a viewport point falls inside the open compose dock. The dock
 *  is position:fixed (.dock-layer), so its bounding rect is already in the
 *  same viewport coordinate space as motion's PanInfo.point — no canvas
 *  pan/zoom conversion needed. Returns false when the dock isn't mounted. */
function isPointOverDock(point: { x: number; y: number }): boolean {
  const el = document.querySelector(".dock-layer");
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return (
    point.x >= r.left &&
    point.x <= r.right &&
    point.y >= r.top &&
    point.y <= r.bottom
  );
}

/**
 * Renders one ImageObject as a draggable canvas tile.
 *
 * Mirrors MRPCard's two-layer motion structure (outer = position +
 * hover lift, inner = drag + picked-up visuals) so selection halation,
 * cursor outline, and group-drag follower sync all behave identically
 * across object variants. The DOM-direct group-drag in MRPCard queries
 * `[data-object-id="..."]` — both variants set that attribute on their
 * wrap div, so a mixed bundle (MRPs + images) group-drags as one.
 *
 * Variant-specific bits live inside the inner layer: just the image
 * itself plus a small checkbox overlay top-left for bundle toggling.
 */
export function ImageCard({ image }: Props) {
  const draggingId = useCanvas((s) => s.draggingId);
  const cursorId = useCanvas((s) => s.cursorId);
  const moveObject = useCanvas((s) => s.moveObject);
  const setDragging = useCanvas((s) => s.setDragging);
  const setCursor = useCanvas((s) => s.setCursor);
  const toggleCheck = useCanvas((s) => s.toggleCheck);
  const removeObject = useCanvas((s) => s.removeObject);
  const imageDeleteHandler = useCanvas((s) => s.imageDeleteHandler);
  const addDockAttachment = useCanvas((s) => s.addDockAttachment);

  const isDragging = draggingId === image.id;
  const isCursor = cursorId === image.id;

  // Motion values: 0 at rest, drift during drag, reset on dragEnd.
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Group-drag follower capture — same DOM-direct pattern as MRPCard.
  // When this tile is bundled, every other bundled object's wrap el
  // gets an imperative `translate` matching the leader's offset (no
  // React re-renders per pointer frame). Commits once on dragEnd.
  const groupDragRef = useRef<{
    followers: Array<{
      id: string;
      el: HTMLElement;
      startX: number;
      startY: number;
    }>;
  } | null>(null);

  // Cleanup-safety (no tap-timer here since images don't expand).
  useEffect(() => () => undefined, []);

  const onDragStart = () => {
    setDragging(image.id);
    setCursor(image.id);

    if (image.checked) {
      const allObjects = useCanvas.getState().objects;
      const bundleFollowers = allObjects.filter(
        (o) => o.checked && o.id !== image.id,
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
        for (const f of captured.followers) {
          f.el.style.transition = "translate 140ms cubic-bezier(0.16, 1, 0.3, 1)";
        }
        groupDragRef.current = captured;
      }
    }
  };

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
    /* DROP-TARGET DETECTION (P4): a PARKED, promotable image (carries an
     * uploadId) released over the OPEN dock stages as a dock attachment —
     * reusing the existing upload, no re-upload. The parked tile STAYS on
     * the board (only becomes "Used" when actually sent), so we snap x/y
     * back to 0 and DON'T persist a move. Group drags (checked bundle) fall
     * through to ordinary move — staging is a single-image gesture.
     * info.point is viewport coords; the dock is position:fixed, so a plain
     * bounding-rect hit-test works regardless of canvas pan/zoom. */
    if (
      !groupDragRef.current &&
      image.uploadId &&
      useCanvas.getState().dockOpen &&
      isPointOverDock(info.point)
    ) {
      addDockAttachment({
        src: image.src,
        alt: image.alt,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        uploadId: image.uploadId,
      });
      x.set(0);
      y.set(0);
      setDragging(null);
      groupDragRef.current = null;
      return;
    }

    moveObject(image.id, image.x + info.offset.x, image.y + info.offset.y);
    x.set(0);
    y.set(0);
    setDragging(null);

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
      // Persist per follower so apps/api stores their new x/y. Without
      // this, the next snapshot returns their OLD positions and they
      // snap back to the grid.
      const persist = useCanvas.getState().movePersistHandler;
      if (persist) {
        for (const [id, { x: nx, y: ny }] of updates) {
          persist(id, nx, ny);
        }
      }
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
    // Single tap moves the cursor here — keeps keyboard nav consistent
    // with how MRPCards behave. No double-tap action (no expanded view
    // for images yet).
    setCursor(image.id);
  };

  const onCheckClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleCheck(image.id);
  };

  // Delete is only offered for PARKED images (persisted, server-backed).
  // Anchored artifact images + client-only materializations have no
  // serverImageId and aren't independently deletable here.
  const isParked = Boolean(image.serverImageId);
  const onDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Optimistic canvas-layer removal; the handler clears server + snapshot.
    removeObject(image.id);
    if (image.serverImageId) imageDeleteHandler?.(image.serverImageId);
  };

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
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        zIndex: isDragging ? 30 : 5,
      }}
      data-checked={image.checked ? "true" : undefined}
      data-object-id={image.id}
      // Reuses the wrap class from MRPCard so the bundle halation +
      // dragging cursor styles apply uniformly. Variant chrome lives
      // in ImageCard.css below.
      className={cn("mrp-card-wrap", isDragging && "is-dragging")}
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
        style={{ x, y, width: image.width, height: image.height }}
        className="mrp-card-drag-layer img-card-frame"
      >
        <div className="img-card">
          <button
            type="button"
            className={cn("img-card-check", image.checked && "img-card-check--on")}
            onClick={onCheckClick}
            aria-label={image.checked ? "Remove from bundle" : "Add to bundle"}
            aria-pressed={image.checked}
          >
            {image.checked && <Check />}
          </button>
          {isParked && (
            <button
              type="button"
              className="img-card-delete"
              onClick={onDeleteClick}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Delete image"
              title="Delete image"
            >
              <Trash2 />
            </button>
          )}
          <img
            src={image.src}
            alt={image.alt ?? ""}
            className="img-card-img"
            draggable={false}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
