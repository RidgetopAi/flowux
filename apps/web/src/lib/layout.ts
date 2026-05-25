/**
 * Auto-flow grid layout for canvas MRPs.
 *
 * Cards flow left-to-right in fixed-width slots, wrapping to the next row
 * when they'd overflow the viewport. The whole arrangement centers around
 * canvas origin (0,0) — the canvas layer is rooted at viewport center,
 * so a centered layout reads as "the stack sits where you are."
 *
 * The arrangement is a START STATE only — once the user drags a card,
 * the store remembers the new position. arrangeGrid is called on initial
 * load and when the user explicitly hits "Arrange" in the controls.
 */

type GridOptions = {
  count: number;
  viewportWidth: number;
  cardWidth?: number;
  gap?: number;
  slotHeight?: number;
  /** Horizontal padding from the viewport edges. */
  sidePadding?: number;
};

const DEFAULTS = {
  // Canvas tiles are uniform 320×240 (--mrp-canvas-w, --mrp-canvas-h).
  // Sized so 4 columns fit at ~1366px viewport with tight side padding —
  // utilizes more screen real estate than the earlier 360-wide tiles.
  cardWidth: 320,
  gap: 16,
  // 240px card + 16px row gap = tighter rows now that height is exact.
  slotHeight: 256,
  sidePadding: 24,
};

/** Hard cap on grid columns regardless of viewport width.
 *  At 100% zoom 4 cards is the comfortable read; wider rows turn into
 *  visual sprawl. Narrow viewports still wrap to fewer columns naturally. */
export const MAX_GRID_COLS = 4;

export function gridDimensions({
  viewportWidth,
  cardWidth = DEFAULTS.cardWidth,
  gap = DEFAULTS.gap,
  sidePadding = DEFAULTS.sidePadding,
}: Omit<GridOptions, "count">) {
  const available = Math.max(cardWidth, viewportWidth - sidePadding * 2);
  const fits = Math.max(1, Math.floor((available + gap) / (cardWidth + gap)));
  const cols = Math.min(MAX_GRID_COLS, fits);
  return { cols };
}

export function arrangeGrid(opts: GridOptions): Array<{ x: number; y: number }> {
  const {
    count,
    cardWidth = DEFAULTS.cardWidth,
    gap = DEFAULTS.gap,
    slotHeight = DEFAULTS.slotHeight,
  } = opts;

  if (count === 0) return [];

  const { cols } = gridDimensions(opts);
  const rows = Math.ceil(count / cols);

  // Total bounding box of the grid
  const totalWidth = cols * cardWidth + (cols - 1) * gap;
  const totalHeight = rows * slotHeight + (rows - 1) * gap;

  // Offset so the bounding box centers around canvas origin (0, 0)
  const offsetX = -totalWidth / 2;
  const offsetY = -totalHeight / 2;

  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: offsetX + col * (cardWidth + gap),
      y: offsetY + row * (slotHeight + gap),
    });
  }
  return positions;
}

/**
 * Compute where a *new* card should land given the current state.
 *
 * Anchors at the EXISTING top-row Y instead of recomputing arrangeGrid's
 * centered offset. Otherwise, adding a card that crosses into a new row
 * shifts the centered offsetY by half-a-row (because totalHeight grows
 * by one row), and the new card lands ABOVE the existing layout's
 * bottom row — causing visual overlap.
 *
 * With anchoring: existing cards stay put, new cards extend downward
 * from the current grid's top. "Arrange All" (which calls arrangeGrid
 * for every card) is the explicit re-centering gesture.
 */
export function nextGridSlot(
  currentCount: number,
  viewportWidth: number,
  existingMrps: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } {
  // First card: use the centered single-card layout from arrangeGrid.
  if (currentCount === 0 || existingMrps.length === 0) {
    return arrangeGrid({ count: 1, viewportWidth })[0] ?? { x: 0, y: 0 };
  }

  const { cols } = gridDimensions({ viewportWidth });
  const { cardWidth, gap, slotHeight } = DEFAULTS;

  // Row 0 Y comes from the topmost existing card — that's what the user
  // currently sees as "the top of the grid," regardless of how arrangeGrid
  // would have centered for the new count.
  const topY = Math.min(...existingMrps.map((m) => m.y));

  const row = Math.floor(currentCount / cols);
  const col = currentCount % cols;

  // X stays centered around 0 using the same column math as arrangeGrid,
  // so columns line up with the existing layout (which was originally
  // centered for its initial count).
  const totalWidth = cols * cardWidth + (cols - 1) * gap;
  const offsetX = -totalWidth / 2;

  return {
    x: offsetX + col * (cardWidth + gap),
    y: topY + row * (slotHeight + gap),
  };
}
