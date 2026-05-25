import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./CardContextMenu.css";

/** One row in the context menu. `kind: "separator"` renders a divider. */
export type MenuItem =
  | {
      kind: "action";
      icon?: ReactNode;
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator" };

type Props = {
  /** Viewport-space anchor (clientX/clientY from the contextmenu event). */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

/**
 * Floating right-click menu rendered via portal so it's never clipped by
 * the canvas layer's scale/translate. Dismisses on: outside click, Esc,
 * window scroll/resize, item selection.
 *
 * Position is clamped to the viewport so a menu opened near the bottom-
 * right corner doesn't get cut off.
 */
export function CardContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Auto-position: after mount, measure and shift back inside the viewport
  // if the menu would overflow. Done in a useEffect so we have a real
  // boundingClientRect (initial render uses raw x/y).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (rect.right > vw - 8) dx = vw - 8 - rect.right;
    if (rect.bottom > vh - 8) dy = vh - 8 - rect.bottom;
    if (dx !== 0 || dy !== 0) {
      el.style.left = `${x + dx}px`;
      el.style.top = `${y + dy}px`;
    }
  }, [x, y]);

  // Dismiss listeners. Capture phase so we catch the click BEFORE any card
  // tap handlers re-fire underneath. We also listen for resize/scroll so a
  // panning gesture doesn't leave the menu floating over the wrong card.
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onDocPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="card-ctx-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.kind === "separator" ? (
          <div key={`sep-${i}`} className="card-ctx-menu__sep" aria-hidden="true" />
        ) : (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            className={`card-ctx-menu__row${item.danger ? " card-ctx-menu__row--danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.icon && <span className="card-ctx-menu__icon">{item.icon}</span>}
            <span className="card-ctx-menu__label">{item.label}</span>
            {item.shortcut && (
              <span className="card-ctx-menu__shortcut">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
