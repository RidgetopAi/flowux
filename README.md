# Flowux

Flowux is a spatial AI thread workspace MVP. Each canvas is a chat thread, and each message-response pair (MRP) is rendered as a movable object while the canonical thread order remains separate from visual layout.

## Development

```bash
npm install
npm run dev
```

The API defaults to a mock model adapter. Configure a llama.cpp/OpenAI-compatible endpoint with:

```bash
FLOWUX_MODEL_MODE=llama_cpp
FLOWUX_MODEL_BASE_URL=http://127.0.0.1:5005
FLOWUX_MODEL_NAME=qwen3.6-35b
```

## Architecture Rule

Conversation truth, canvas placement, and model context are separate:

- `MRP.sequence` defines canonical model/thread order.
- `CanvasPlacement.x/y` defines human layout only.
- Checked placements produce context bundles sorted by canonical MRP sequence.

