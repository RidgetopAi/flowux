import type { CanvasObject } from "./store";

/**
 * Seed fixtures for the canvas. Six MRPs in varied states with one
 * parent → child branch so the connector demo lights up.
 *
 * Positions are loose — loadFixtures re-flows them into the auto-grid
 * on mount so the initial state always reads as a clean organized stack.
 */
export const SEED_OBJECTS: CanvasObject[] = [
  {
    type: "mrp",
    id: "mrp-001",
    sequence: 1,
    x: -540,
    y: -180,
    width: 320,
    height: 240,
    status: "complete",
    prompt: "What's a spatial canvas good for that a linear chat isn't?",
    response:
      "Spatial canvases let you see multiple threads of reasoning side-by-side, manipulate the context that feeds the next prompt, and branch without losing the parent. Linear chats hide all of that in scrollback.",
    model: "opus-4.7",
    tokens: 1240,
    timestamp: "2026-05-23T09:14:22Z",
    checked: true,
  },
  {
    type: "mrp",
    id: "mrp-002",
    sequence: 2,
    x: -60,
    y: -240,
    width: 320,
    height: 240,
    status: "complete",
    prompt: "Show me the architecture rule that keeps thread order separate from layout.",
    response:
      "MRP.sequence is the canonical thread order — what the model sees. CanvasPlacement.x/y is human layout only. When you check cards to compose a context bundle, the bundle sorts by sequence, not screen position. Two truths, never coupled.",
    model: "opus-4.7",
    tokens: 1830,
    timestamp: "2026-05-23T09:18:41Z",
    checked: true,
  },
  {
    type: "mrp",
    id: "mrp-003",
    sequence: 3,
    x: 420,
    y: -160,
    width: 320,
    height: 240,
    status: "complete",
    prompt: "What does branching cost the parent thread?",
    response:
      "Nothing. A branch is just a new MRP whose parent is set. The parent's bundle, its responses, its place on the canvas — all untouched. You can run three branches off one parent and the parent doesn't know.",
    model: "opus-4.7",
    tokens: 980,
    timestamp: "2026-05-23T09:22:08Z",
    checked: false,
    parentId: "mrp-002",
  },
  {
    type: "mrp",
    id: "mrp-004",
    sequence: 4,
    x: -300,
    y: 220,
    width: 320,
    height: 240,
    status: "active",
    prompt: "Sketch the file-drop flow for multimedia (images + pdfs + iframes).",
    response:
      "User drags onto canvas → drop zone highlights → file becomes an MRP attachment node (or a card if it's a doc) → preview renders in-card (image inline, pdf iframe, link as embed card) → checked nodes attach to the next prompt as multimodal context.",
    model: "opus-4.7",
    tokens: 2140,
    timestamp: "2026-05-23T09:31:50Z",
    checked: false,
  },
  {
    type: "mrp",
    id: "mrp-005",
    sequence: 5,
    x: 260,
    y: 240,
    width: 320,
    height: 240,
    status: "pending",
    prompt: "How should the prompt dock surface what's in the context bundle?",
    response:
      "A horizontal strip above the textarea showing checked MRP titles as chips. Click a chip to scroll its card into view. The bundle's token count sits inline so you feel the cost before you send.",
    model: "opus-4.7",
    tokens: 0,
    timestamp: "2026-05-23T09:35:12Z",
    checked: false,
  },
  {
    type: "mrp",
    id: "mrp-006",
    sequence: 6,
    x: 760,
    y: 60,
    width: 320,
    height: 240,
    status: "complete",
    prompt: "Pull in the design lesson from the Ridgey project on motion language.",
    response:
      "From the Ridgey notes: chunky base shape + 6 distinct poses, each animation reading clearly at thumbnail size. Idle is the most important — it sets the personality. Apply the same here: the idle canvas state is the soul of FlowUX.",
    model: "opus-4.7",
    tokens: 1560,
    timestamp: "2026-05-23T09:42:30Z",
    checked: false,
    external: true,
  },
];
