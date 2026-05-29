/* ─────────────────────────────────────────────────────────────────────────
   ENGINE · INPUT
   Window-level keyboard tracking. The loop reads `state.left/right` each
   tick instead of subscribing to events directly — keeps simulation in
   tick-time, not event-time. `firePressed` and `startPressed` are
   one-shot edge triggers (consumed by the loop) so holding the key
   doesn't auto-repeat fire / restart.
   ──────────────────────────────────────────────────────────────────────── */

export type InputState = {
  left: boolean;
  right: boolean;
  /** True for one tick after Space is pressed. The loop consumes it
   *  (sets back to false) after handling. */
  firePressed: boolean;
  /** True for one tick after Enter or Space is pressed during attract /
   *  game-over phases. Consumed by the phase transition handler. */
  startPressed: boolean;
};

export type InputHandle = {
  state: InputState;
  dispose: () => void;
};

const LEFT_KEYS = new Set(["ArrowLeft", "a", "A"]);
const RIGHT_KEYS = new Set(["ArrowRight", "d", "D"]);
const FIRE_KEYS = new Set([" ", "Space", "ArrowUp", "w", "W"]);
const START_KEYS = new Set([" ", "Enter"]);

/** Wire up window-level keyboard tracking. Returns the live input state
 *  + a dispose() to detach the listeners. */
export function createInputHandler(): InputHandle {
  const state: InputState = {
    left: false,
    right: false,
    firePressed: false,
    startPressed: false,
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Don't interfere with browser/OS shortcuts that use modifiers.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (LEFT_KEYS.has(e.key)) {
      state.left = true;
      e.preventDefault();
    }
    if (RIGHT_KEYS.has(e.key)) {
      state.right = true;
      e.preventDefault();
    }
    // Fire / start are edge-triggered. Setting them on each keydown is
    // fine — the loop consumes them within one tick, before keyup fires.
    if (FIRE_KEYS.has(e.key)) {
      state.firePressed = true;
      e.preventDefault();
    }
    if (START_KEYS.has(e.key)) {
      state.startPressed = true;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (LEFT_KEYS.has(e.key)) state.left = false;
    if (RIGHT_KEYS.has(e.key)) state.right = false;
  };

  // Lose focus → release all keys so the player doesn't keep drifting.
  const onBlur = () => {
    state.left = false;
    state.right = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    state,
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
